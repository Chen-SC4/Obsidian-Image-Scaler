import { Plugin } from "obsidian";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { extractFirstImagePath } from "./utils"; // 导入提取图片路径的工具函数
// 导入 EditorState, EditorSelection, Transaction 用于修改编辑器内容

// 辅助函数：尝试从DOM元素向上追溯，找到其在CodeMirror文档中的位置和对应行的文本
// 这对于处理嵌套在复杂Widget中的图片元素尤其重要
function getLineInfoFromElement(
	view: EditorView,
	element: HTMLElement
): { pos: number; lineText: string; lineFrom: number; lineTo: number } | null {
	let pos: number | undefined;

	if (pos === undefined) {
		try {
			pos = view.posAtDOM(element);
		} catch (e) {
			// console.warn("posAtDOM failed for element:", element, e);
			return null;
		}
	}

	if (pos === null || pos === undefined) return null;

	try {
		const line = view.state.doc.lineAt(pos);
		console.log("获取行信息成功:", line, pos);
		return {
			pos,
			lineText: line.text,
			lineFrom: line.from,
			lineTo: line.to,
		};
	} catch (e) {
		console.error("Error getting line text from element position:", pos, e);
		return null;
	}
}

export default class ObsidianImageEnhancePlugin extends Plugin {
	async onload() {
		console.log("图片增强插件加载成功!");
		this.registerEditorExtension(this.createLivePreviewHoverExtension());
	}

	createLivePreviewHoverExtension() {
		// 使用一个类来创建 ViewPlugin，这样可以管理状态和事件监听器
		return ViewPlugin.fromClass(ImageHoverViewPlugin);
	}

	onunload() {
		console.log("图片增强插件卸载!");
	}
}

class ImageHoverViewPlugin {
	private contentDom: HTMLElement;
	private lastHoveredImg: HTMLImageElement | null = null;

	private activeImgMouseMoveUnlistener: (() => void) | null = null;
	private activeImgMouseLeaveUnlistener: (() => void) | null = null;
	private activeImgMouseDownUnlistener: (() => void) | null = null; // 新增：用于mousedown事件

	// 拖拽状态相关
	private isDragging = false;
	private dragStartX = 0;
	private dragStartY = 0;
	private initialImageWidth = 0; // 用于百分比缩放计算
	private initialImageHeight = 0; // 用于百分比缩放计算
	private currentZoomPercent = 100; // 当前图片的缩放百分比
	private lineInfoAtDragStart: {
		pos: number;
		lineText: string;
		lineFrom: number;
		lineTo: number;
	} | null = null; // 拖拽开始时的行信息
	private originalImagePath: string | null = null; // 拖拽开始时解析到的原始图片路径
	private imageCenterX = 0; // 图片中心点X坐标
	private imageCenterY = 0; // 图片中心点Y坐标
	private initialDistanceToCenter = 0; // 鼠标按下时，点到图片中心的初始距离

	constructor(private view: EditorView) {
		this.contentDom = view.contentDOM;

		this.handleContainerMouseMove =
			this.handleContainerMouseMove.bind(this);
		this.handleContainerMouseLeave =
			this.handleContainerMouseLeave.bind(this);
		// 绑定新的处理器
		this.handleImageSpecificMouseDown =
			this.handleImageSpecificMouseDown.bind(this);
		this.handleDocumentMouseMoveWhileDragging =
			this.handleDocumentMouseMoveWhileDragging.bind(this);
		this.handleDocumentMouseUp = this.handleDocumentMouseUp.bind(this);

		this.contentDom.addEventListener(
			"mousemove",
			this.handleContainerMouseMove
		);
		this.contentDom.addEventListener(
			"mouseleave",
			this.handleContainerMouseLeave
		);
	}

	update(update: ViewUpdate) {
		// 如果文档发生变化，且当前正在拖拽的图片受到了影响，可能需要重置状态
		if (this.isDragging && update.docChanged) {
			const imgElement = this.lastHoveredImg;
			if (imgElement && !document.body.contains(imgElement)) {
				// 元素被移除
				// console.log("拖拽中的图片元素已从文档中移除，重置拖拽状态。");
				this.resetDragState();
			} else if (this.lineInfoAtDragStart) {
				// 检查拖拽开始时的行内容是否发生变化
				// 这是一个简化检查，更复杂的场景可能需要更精确的跟踪
				try {
					const currentLine = this.view.state.doc.lineAt(
						this.lineInfoAtDragStart.pos
					);
					if (
						currentLine.text !== this.lineInfoAtDragStart.lineText
					) {
						// console.log("拖拽中的图片所在行内容已改变，重置拖拽状态。");
						// this.resetDragState(); // 谨慎：可能过于敏感，若只是zoom值更新则不应重置
					}
				} catch (e) {
					// console.warn("检查拖拽行变化时出错，重置状态", e);
					this.resetDragState();
				}
			}
		}
	}

	private resetDragState() {
		this.isDragging = false;
		document.removeEventListener(
			"mousemove",
			this.handleDocumentMouseMoveWhileDragging
		);
		document.removeEventListener("mouseup", this.handleDocumentMouseUp);
		this.lineInfoAtDragStart = null;
		this.originalImagePath = null;
		// console.log("拖拽状态已重置。");
		// 恢复光标等，如果需要
		if (this.lastHoveredImg) {
			this.lastHoveredImg.style.cursor = "default"; // 或根据上下文设置回 grab/edge cursors
		}
	}

	destroy() {
		this.contentDom.removeEventListener(
			"mousemove",
			this.handleContainerMouseMove
		);
		this.contentDom.removeEventListener(
			"mouseleave",
			this.handleContainerMouseLeave
		);
		this.clearActiveImageState(); // 会清理图片上的监听器
		// 确保全局监听器也被移除（以防万一）
		document.removeEventListener(
			"mousemove",
			this.handleDocumentMouseMoveWhileDragging
		);
		document.removeEventListener("mouseup", this.handleDocumentMouseUp);
	}

	private clearActiveImageState() {
		if (this.lastHoveredImg) {
			this.lastHoveredImg.classList.remove("image-hover-highlight");
			this.lastHoveredImg.style.cursor = "";

			if (this.activeImgMouseMoveUnlistener)
				this.activeImgMouseMoveUnlistener();
			if (this.activeImgMouseLeaveUnlistener)
				this.activeImgMouseLeaveUnlistener();
			if (this.activeImgMouseDownUnlistener)
				this.activeImgMouseDownUnlistener(); // 清理 mousedown 监听器

			this.activeImgMouseMoveUnlistener = null;
			this.activeImgMouseLeaveUnlistener = null;
			this.activeImgMouseDownUnlistener = null;
			this.lastHoveredImg = null;
		}
		// 如果因为图片状态清除而中断拖拽
		if (this.isDragging) {
			this.resetDragState();
		}
	}

	private handleContainerMouseMove(event: MouseEvent) {
		if (this.isDragging) return; // 如果正在拖拽，则不处理容器的 mousemove 来切换图片

		const targetElement = event.target as HTMLElement;
		let currentTargetIsOurImage = false;

		// 更精确地定位图片，特别是当图片被包裹时
		const imgCheck = targetElement.closest(
			"img, .cm-widgetImage img, .image-embed img, span.cm-image img, figure.image-container img"
		);

		if (
			imgCheck &&
			imgCheck.nodeName === "IMG" &&
			this.contentDom.contains(imgCheck)
		) {
			const imgTarget = imgCheck as HTMLImageElement;
			currentTargetIsOurImage = true;

			if (this.lastHoveredImg !== imgTarget) {
				this.clearActiveImageState(); // 清理上一个图片的状态
				this.lastHoveredImg = imgTarget;
				imgTarget.classList.add("image-hover-highlight");

				const onImageMouseMove = (e: MouseEvent) =>
					this.handleImageSpecificMouseMove(e, imgTarget);
				const onImageMouseLeave = (e: MouseEvent) =>
					this.handleImageSpecificMouseLeave(e, imgTarget);
				const onImageMouseDown = (e: MouseEvent) =>
					this.handleImageSpecificMouseDown(e, imgTarget); // 新增

				imgTarget.addEventListener("mousemove", onImageMouseMove);
				imgTarget.addEventListener("mouseleave", onImageMouseLeave);
				imgTarget.addEventListener("mousedown", onImageMouseDown); // 添加 mousedown 监听

				this.activeImgMouseMoveUnlistener = () =>
					imgTarget.removeEventListener(
						"mousemove",
						onImageMouseMove
					);
				this.activeImgMouseLeaveUnlistener = () =>
					imgTarget.removeEventListener(
						"mouseleave",
						onImageMouseLeave
					);
				this.activeImgMouseDownUnlistener = () =>
					imgTarget.removeEventListener(
						"mousedown",
						onImageMouseDown
					); // 保存解绑函数
			}
		}

		if (!currentTargetIsOurImage && this.lastHoveredImg) {
			if (!this.lastHoveredImg.contains(targetElement)) {
				this.clearActiveImageState();
			}
		}
	}

	private handleContainerMouseLeave(event: MouseEvent) {
		if (this.isDragging) return; // 拖拽时不处理

		const relatedTargetIsOutside =
			!event.relatedTarget ||
			!this.contentDom.contains(event.relatedTarget as Node);
		if (relatedTargetIsOutside) {
			this.clearActiveImageState();
		}
	}

	private handleImageSpecificMouseMove(
		event: MouseEvent,
		imgElement: HTMLImageElement
	) {
		if (this.isDragging) {
			// 如果正在拖拽，则由 document 级别事件处理光标和逻辑
			return;
		}
		const rect = imgElement.getBoundingClientRect();
		const sensitivity = 8;
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;

		let cursorStyle = "grab"; // 默认为抓取光标，表示图片可交互
		const onLeftEdge = x < sensitivity;
		const onRightEdge = x > rect.width - sensitivity;
		const onTopEdge = y < sensitivity;
		const onBottomEdge = y > rect.height - sensitivity;

		if (onTopEdge && onLeftEdge) cursorStyle = "nwse-resize";
		else if (onTopEdge && onRightEdge) cursorStyle = "nesw-resize";
		else if (onBottomEdge && onLeftEdge) cursorStyle = "nesw-resize";
		else if (onBottomEdge && onRightEdge) cursorStyle = "nwse-resize";
		else if (onLeftEdge || onRightEdge) cursorStyle = "ew-resize";
		else if (onTopEdge || onBottomEdge) cursorStyle = "ns-resize";

		imgElement.style.cursor = cursorStyle;
	}

	private handleImageSpecificMouseLeave(
		event: MouseEvent,
		imgElement: HTMLImageElement
	) {
		if (!this.isDragging) {
			// 只有在非拖拽状态下移出图片才恢复默认光标
			imgElement.style.cursor = "";
		}
	}

	/**
	 * 当在图片上按下鼠标时触发 (已通过 handleContainerMouseMove 添加监听)
	 */
	private handleImageSpecificMouseDown(
		event: MouseEvent,
		imgElement: HTMLImageElement
	) {
		const cursorStyle = imgElement.style.cursor;
		// 只有当光标是缩放光标时才开始拖拽缩放逻辑
		if (cursorStyle && cursorStyle.includes("-resize")) {
			event.preventDefault(); // 阻止默认行为，如图片被拖动或文本被选中
			event.stopPropagation(); // 阻止事件冒泡

			const rect = imgElement.getBoundingClientRect();
			this.imageCenterX = rect.left + rect.width / 2;
			this.imageCenterY = rect.top + rect.height / 2;

			this.isDragging = true;
			this.dragStartX = event.clientX;
			this.dragStartY = event.clientY;

			const dxToCenterInitial = event.clientX - this.imageCenterX;
			const dyToCenterInitial = event.clientY - this.imageCenterY;
			this.initialDistanceToCenter = Math.sqrt(
				dxToCenterInitial * dxToCenterInitial +
					dyToCenterInitial * dyToCenterInitial
			);

			// 记录图片初始尺寸用于计算相对缩放
			this.initialImageWidth = imgElement.offsetWidth;
			this.initialImageHeight = imgElement.offsetHeight;

			// 获取图片所在行的信息
			this.lineInfoAtDragStart = getLineInfoFromElement(
				this.view,
				imgElement
			);

			if (this.lineInfoAtDragStart) {
				const { lineText, lineFrom, lineTo } = this.lineInfoAtDragStart;
				this.originalImagePath = extractFirstImagePath(lineText);

				if (this.originalImagePath) {
					console.log(
						`开始拖拽缩放图片。路径: ${this.originalImagePath}`
					);
					// console.log(`行内容: "${lineText}" 从 ${lineFrom} 到 ${lineTo}`);

					// 检查当前是否已经是HTML格式，并提取zoom值
					const htmlImgRegex =
						/<img\s[^>]*src="([^"]+)"[^>]*style="[^"]*zoom:\s*(\d+)%[^"]*"[^>]*>/i;
					const htmlMatch = lineText.match(htmlImgRegex);

					if (
						htmlMatch &&
						htmlMatch[1] === this.originalImagePath &&
						htmlMatch[2]
					) {
						this.currentZoomPercent = parseInt(htmlMatch[2], 10);
						// console.log(`已是HTML格式，当前缩放: ${this.currentZoomPercent}%`);
						// 不需要转换，直接准备更新zoom
					} else {
						// 不是我们期望的HTML格式，或者路径不匹配，进行转换
						// console.log("需要转换为HTML <img> 标签或更新现有标签。");
						this.currentZoomPercent = 100; // 转换时默认100%
						const newImgTag = `<img src="${this.originalImagePath}" style="zoom: ${this.currentZoomPercent}%;">`;

						// 找到需要替换的Markdown图片语法部分
						const mdOrWikiRegex =
							/(?:!\[[^\]]*\]\((?:[^)]+)\))|(?:!\[\[(?:[^|\]]+)(?:\|[^\]]*)?\]\])/;
						const mdMatch = lineText.match(mdOrWikiRegex);

						if (mdMatch && mdMatch[0]) {
							const from = lineFrom + (mdMatch.index ?? 0);
							const to = from + mdMatch[0].length;
							// console.log(`将替换 "${mdMatch[0]}" 为 "${newImgTag}"`);

							const tr = this.view.state.update({
								changes: { from, to, insert: newImgTag },
								selection: {
									anchor:
										to +
										(newImgTag.length - mdMatch[0].length),
								}, // 尝试将光标移到替换后内容之后
								userEvent: "image.resize.convert",
							});
							this.view.dispatch(tr);
							// 更新行信息，因为内容已改变
							this.lineInfoAtDragStart = {
								...this.lineInfoAtDragStart,
								lineText:
									lineText.substring(0, mdMatch.index ?? 0) +
									newImgTag +
									lineText.substring(
										(mdMatch.index ?? 0) + mdMatch[0].length
									),
								lineTo:
									lineTo +
									(newImgTag.length - mdMatch[0].length),
							};
						} else {
							console.warn(
								"无法在行中找到Markdown图片语法进行替换。原始路径：",
								this.originalImagePath,
								"行内容：",
								lineText
							);
							this.resetDragState(); // 无法进行转换，重置状态
							return;
						}
					}
				} else {
					console.warn(
						"在 mousedown 时无法从行文本中提取图片路径:",
						lineText
					);
					this.resetDragState(); // 获取不到路径，重置
					return;
				}
			} else {
				console.warn("在 mousedown 时无法获取图片所在行的信息。");
				this.resetDragState(); // 获取不到行信息，重置
				return;
			}

			// 添加全局监听器来处理拖拽过程和结束
			document.addEventListener(
				"mousemove",
				this.handleDocumentMouseMoveWhileDragging
			);
			document.addEventListener("mouseup", this.handleDocumentMouseUp);
		}
	}

	/**
	 * 当鼠标在整个文档上移动时触发 (仅当 isDragging 为 true 时)
	 */
	private handleDocumentMouseMoveWhileDragging(event: MouseEvent) {
		if (
			!this.isDragging ||
			!this.lastHoveredImg ||
			!this.lineInfoAtDragStart ||
			!this.originalImagePath
		) {
			this.resetDragState();
			return;
		}
		event.preventDefault();
		event.stopPropagation();

		const currentMouseX = event.clientX;
		const currentMouseY = event.clientY;

		// 计算当前鼠标位置到图片中心点的距离
		const dxToCenterCurrent = currentMouseX - this.imageCenterX;
		const dyToCenterCurrent = currentMouseY - this.imageCenterY;
		const currentDistanceToCenter = Math.sqrt(
			dxToCenterCurrent * dxToCenterCurrent +
				dyToCenterCurrent * dyToCenterCurrent
		);

		// 计算鼠标到中心点距离的变化量
		const distanceChange =
			currentDistanceToCenter - this.initialDistanceToCenter;

		// 定义缩放灵敏度：每像素的距离变化对应多少百分比的缩放
		// 例如，zoomSensitivity = 0.5 表示鼠标到中心的距离每改变1像素，缩放值改变0.5%
		// 你可以调整这个值来获得期望的拖拽手感
		const zoomSensitivity = 0.2; // <<--- 调整这个值来改变灵敏度
		const zoomDelta = distanceChange * zoomSensitivity;

		let newZoom = Math.round(this.currentZoomPercent + zoomDelta);
		newZoom = Math.max(10, Math.min(newZoom, 500)); // 限制缩放范围

		this.lastHoveredImg.style.zoom = `${newZoom}%`;
		// 用于调试:
		// console.log(`InitialDist: ${this.initialDistanceToCenter.toFixed(1)}, CurrentDist: ${currentDistanceToCenter.toFixed(1)}, DistChange: ${distanceChange.toFixed(1)}, ZoomDelta: ${zoomDelta.toFixed(1)}, NewZoom: ${newZoom}%`);
	}

	/**
	 * 当鼠标按键在整个文档上松开时触发 (仅当 isDragging 为 true 时)
	 */
	private handleDocumentMouseUp(event: MouseEvent) {
		if (
			!this.isDragging ||
			!this.lastHoveredImg ||
			!this.lineInfoAtDragStart ||
			!this.originalImagePath
		) {
			this.resetDragState();
			return;
		}
		event.preventDefault();
		event.stopPropagation();

		// 从实时更新的DOM style中获取最终的zoom值
		const finalZoomMatch = this.lastHoveredImg.style.zoom.match(/(\d+)/);
		let finalZoomPercent = this.currentZoomPercent; // 默认为拖拽开始时的值

		if (finalZoomMatch && finalZoomMatch[1]) {
			finalZoomPercent = parseInt(finalZoomMatch[1], 10);
		}
		finalZoomPercent = Math.max(10, Math.min(finalZoomPercent, 500)); // 再次确保在范围内

		console.log(`拖拽结束，最终缩放: ${finalZoomPercent}%`);

		// 更新编辑器中的 Markdown/HTML 文本
		const { lineFrom } = this.lineInfoAtDragStart;
		const newImgTag = `<img src="${this.originalImagePath}" style="zoom: ${finalZoomPercent}%;">`;

		// 查找旧的 img 标签或 Markdown 语法进行替换
		// 优先查找已经存在的 <img src="path" style="zoom: ..."> 结构
		const htmlImgWithZoomRegex = new RegExp(
			`<img\\s+src="${this.originalImagePath.replace(
				/[.*+?^${}()|[\]\\]/g,
				"\\$&"
			)}"` + // 转义路径中的特殊字符
				`[^>]*style="[^"]*zoom:\\s*\\d+%?[^"]*"[^>]*>`,
			"i"
		);
		const htmlImgSimpleRegex = new RegExp(
			`<img\\s+src="${this.originalImagePath.replace(
				/[.*+?^${}()|[\]\\]/g,
				"\\$&"
			)}"[^>]*>`,
			"i"
		);
		// Markdown 和 Wikilink (作为转换前的备选)
		const mdOrWikiRegex =
			/(?:!\[[^\]]*\]\((?:[^)]+)\))|(?:!\[\[(?:[^|\]]+)(?:\|[^\]]*)?\]\])/;

		let fromPos: number | undefined;
		let toPos: number | undefined;
		let textToReplaceLength: number | undefined;

		// 1. 尝试匹配带zoom的HTML标签 (最理想情况)
		const currentLineContent = this.view.state.doc.lineAt(lineFrom).text; // 获取最新的行内容
		let match = currentLineContent.match(htmlImgWithZoomRegex);
		if (match && match[0]) {
			fromPos = lineFrom + (match.index ?? 0);
			textToReplaceLength = match[0].length;
			toPos = fromPos + textToReplaceLength;
		} else {
			// 2. 尝试匹配不带zoom的HTML标签 (可能是第一次转换后，拖拽前未找到zoom)
			match = currentLineContent.match(htmlImgSimpleRegex);
			if (
				match &&
				match[0] &&
				match[0].includes(this.originalImagePath)
			) {
				// 确保是同一个图片
				fromPos = lineFrom + (match.index ?? 0);
				textToReplaceLength = match[0].length;
				toPos = fromPos + textToReplaceLength;
			} else {
				// 3. 尝试匹配原始的Markdown/Wikilink (如果转换步骤因为某些原因未完全执行或在拖拽前被修改)
				// 这种情况理论上在mousedown时已经被转换，但作为健壮性考虑
				match = currentLineContent.match(mdOrWikiRegex);
				if (
					match &&
					match[0] &&
					(match[0].includes(this.originalImagePath) ||
						extractFirstImagePath(match[0]) ===
							this.originalImagePath)
				) {
					fromPos = lineFrom + (match.index ?? 0);
					textToReplaceLength = match[0].length;
					toPos = fromPos + textToReplaceLength;
				}
			}
		}

		if (
			fromPos !== undefined &&
			toPos !== undefined &&
			textToReplaceLength !== undefined
		) {
			// console.log(`准备更新文档: 从 ${fromPos} 到 ${toPos}, 替换为 "${newImgTag}"`);
			const tr = this.view.state.update({
				changes: { from: fromPos, to: toPos, insert: newImgTag },
				selection: { anchor: this.view.state.selection.main.head }, // 保持光标位置
				userEvent: "image.resize.update",
			});
			this.view.dispatch(tr);
			console.log(
				`图片 "${this.originalImagePath}" 的缩放已更新为 ${finalZoomPercent}%`
			);
		} else {
			console.warn(
				"拖拽结束，但无法在文档中定位到要更新的图片标签。行内容：",
				currentLineContent,
				"期望路径：",
				this.originalImagePath
			);
		}

		this.resetDragState(); // 清理拖拽状态
		// 主动清除一下高亮图片的引用，确保下次悬停时重新判断
		// this.clearActiveImageState(); // 根据需要，看是否需要立即清除，或者等下一次mousemove
	}
}
