import { Plugin } from "obsidian";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import {
	parseImageSyntaxFromLine,
	escapeHtml,
	escapeRegExp,
	getLineInfoFromElement,
} from "./utils"; // 导入提取图片路径的工具函数
// 导入 EditorState, EditorSelection, Transaction 用于修改编辑器内容

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
	private draggedImageInfo: {
		path: string | null;
		altText?: string;
		sourceWidth?: number;
		sourceHeight?: number;
	} | null = null; // 拖拽开始时的图片信息
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
		this.draggedImageInfo = null;
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
		if (cursorStyle && cursorStyle.includes("-resize")) {
			event.preventDefault();
			event.stopPropagation();

			this.lineInfoAtDragStart = getLineInfoFromElement(
				this.view,
				imgElement
			);

			if (this.lineInfoAtDragStart) {
				const { lineText, lineFrom } = this.lineInfoAtDragStart;
				const parsedInfo = parseImageSyntaxFromLine(lineText); // 统一调用解析

				if (parsedInfo) {
					this.draggedImageInfo = {
						// 初始化 draggedImageInfo
						path: parsedInfo.path,
						altText: parsedInfo.altText,
						sourceWidth: parsedInfo.specifiedWidth,
						sourceHeight: parsedInfo.specifiedHeight,
					};
					console.log(
						`图片拖拽准备: Path="${
							this.draggedImageInfo.path
						}", Type=${parsedInfo.isHtml ? "HTML" : "MD/Wiki"}, W=${
							parsedInfo.specifiedWidth
						}, H=${parsedInfo.specifiedHeight}, Zoom=${
							parsedInfo.currentZoomPercent
						}`
					);

					// 设置拖拽灵敏度相关的 initialImageWidth
					if (parsedInfo.specifiedWidth) {
						this.initialImageWidth = parsedInfo.specifiedWidth;
					} else {
						this.initialImageWidth = imgElement.offsetWidth;
					}
					if (!this.initialImageWidth || this.initialImageWidth <= 0)
						this.initialImageWidth = 200;

					// 图片中心点和初始鼠标距离计算 (逻辑不变)
					const rect = imgElement.getBoundingClientRect();
					this.imageCenterX = rect.left + rect.width / 2;
					this.imageCenterY = rect.top + rect.height / 2;
					this.dragStartX = event.clientX;
					this.dragStartY = event.clientY;
					const initialDxToCenter = event.clientX - this.imageCenterX;
					const initialDyToCenter = event.clientY - this.imageCenterY;
					this.initialDistanceToCenter = Math.sqrt(
						initialDxToCenter * initialDxToCenter +
							initialDyToCenter * initialDyToCenter
					);

					// 根据解析类型决定行为
					if (parsedInfo.isHtml) {
						// 如果是HTML，直接使用解析出的zoom（或默认100%），不需要转换markdown
						this.currentZoomPercent =
							parsedInfo.currentZoomPercent !== undefined
								? parsedInfo.currentZoomPercent
								: 100;
						// draggedImageInfo 中的 sourceWidth/Height 已从 parsedInfo 设置，无需再从 style 解析
						console.log(
							`处理现有HTML: Zoom=${this.currentZoomPercent}%, 继承尺寸 W=${this.draggedImageInfo.sourceWidth}, H=${this.draggedImageInfo.sourceHeight}`
						);
					} else {
						// Markdown 或 Wikilink，需要转换为HTML
						this.currentZoomPercent = 100; // 新转换的HTML，zoom从100%开始

						let styleString = "";
						if (this.draggedImageInfo.sourceWidth)
							styleString += `width: ${this.draggedImageInfo.sourceWidth}px; `;
						if (this.draggedImageInfo.sourceHeight)
							styleString += `height: ${this.draggedImageInfo.sourceHeight}px; `;
						styleString += `zoom: ${this.currentZoomPercent}%;`;

						const safeAltText = this.draggedImageInfo.altText
							? escapeHtml(this.draggedImageInfo.altText)
							: "";
						const newImgTag = `<img src="${
							this.draggedImageInfo.path
						}" alt="${safeAltText}" style="${styleString.trim()}">`;

						const from = lineFrom + parsedInfo.startIndexInLine;
						const to = from + parsedInfo.originalMatch.length;

						console.log(
							`转换MD/Wiki为HTML: 从 "${parsedInfo.originalMatch}" 到 "${newImgTag}"`
						);
						const tr = this.view.state.update({
							changes: { from, to, insert: newImgTag },
							selection: {
								anchor: this.view.state.selection.main.head,
							},
							userEvent: "image.resize.convert",
						});
						this.view.dispatch(tr);
					}
				} else {
					console.warn(
						"Mousedown: 无法解析行中的任何图片语法:",
						lineText
					);
					this.resetDragState();
					return;
				}
			} else {
				console.warn("Mousedown: 无法获取图片所在行的信息。");
				this.resetDragState();
				return;
			}

			this.isDragging = true;
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
			!this.draggedImageInfo?.path
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
			!this.draggedImageInfo
		) {
			// 确保draggedImageInfo存在
			this.resetDragState();
			return;
		}
		event.preventDefault();
		event.stopPropagation();

		const finalZoomMatch = this.lastHoveredImg.style.zoom.match(/(\d+)/);
		let finalZoomPercent = this.currentZoomPercent;
		if (finalZoomMatch && finalZoomMatch[1]) {
			finalZoomPercent = parseInt(finalZoomMatch[1], 10);
		}
		finalZoomPercent = Math.max(10, Math.min(finalZoomPercent, 500));

		console.log(`拖拽结束，最终缩放: ${finalZoomPercent}%`);

		// 构建最终的img标签，包含sourceWidth和sourceHeight（如果存在）
		let finalStyleString = "";
		if (this.draggedImageInfo.sourceWidth) {
			finalStyleString += `width: ${this.draggedImageInfo.sourceWidth}px; `;
		}
		if (this.draggedImageInfo.sourceHeight) {
			finalStyleString += `height: ${this.draggedImageInfo.sourceHeight}px; `;
		}
		finalStyleString += `zoom: ${finalZoomPercent}%;`;

		const safeAltTextFinal = this.draggedImageInfo.altText
			? escapeHtml(this.draggedImageInfo.altText)
			: "";
		const newImgTagFinal = `<img src="${
			this.draggedImageInfo.path
		}" alt="${safeAltTextFinal}" style="${finalStyleString.trim()}">`;

		// 更新文档中的标签
		const { lineFrom } = this.lineInfoAtDragStart;
		// 获取最新的行内容，因为在mousedown时可能已经转换过一次
		const currentLineContent = this.view.state.doc.lineAt(lineFrom).text;

		// 更新正则表达式以准确找到我们之前生成或正在操作的img标签
		// 它应该能匹配到 <img src="path" ... style="..."> 结构
		const imgTagToReplaceRegex = new RegExp(
			`<img\\s+src=(?:["']${escapeRegExp(
				this.draggedImageInfo.path ?? ""
			)}["']|${escapeRegExp(this.draggedImageInfo.path ?? "")})` + // 匹配src
				`[^>]*>`, // 匹配到标签结束
			"i"
		);

		const matchForUpdate = currentLineContent.match(imgTagToReplaceRegex);
		let fromPos: number | undefined, toPos: number | undefined;

		if (matchForUpdate && matchForUpdate.index !== undefined) {
			fromPos = lineFrom + matchForUpdate.index;
			toPos = fromPos + matchForUpdate[0].length;
		} else {
			// 如果上面没匹配到，可能是因为原始行是Markdown，在mousedown时被替换了，但lineInfoAtDragStart.lineText可能仍是旧的
			// 这种情况理论上应该在 mousedown 后更新 lineInfoAtDragStart.lineText 或用更可靠的方式定位。
			// 另一种可能是 DOM 和 Doc 的同步问题。
			// 作为一个备选，如果上面找不到，并且我们知道它最初是MD/Wikilink，可以尝试用初始的parsedInfo的定位信息
			// 但这会比较复杂，优先确保上面的正则能找到由插件生成的img标签。
			console.warn(
				`MouseUp: 无法在行中找到要更新的 <img /> 标签。行内容: "${currentLineContent}", 期望路径: ${this.draggedImageInfo.path}`
			);
			// 尝试使用原始的 markdown/wikilink 匹配信息（如果 mousedown 时没有成功替换或被撤销）
			// 这一步是为了健壮性，但理想情况下，上面的正则应该能工作
			const originalSyntaxInfo = parseImageSyntaxFromLine(
				this.lineInfoAtDragStart.lineText
			); // 用原始行文本再解析一次
			if (
				originalSyntaxInfo &&
				originalSyntaxInfo.path === this.draggedImageInfo.path
			) {
				console.log(
					"MouseUp: 尝试使用原始Markdown/Wikilink位置进行替换。"
				);
				fromPos = lineFrom + originalSyntaxInfo.startIndexInLine;
				toPos = fromPos + originalSyntaxInfo.originalMatch.length;
			} else {
				this.resetDragState();
				return;
			}
		}

		if (fromPos !== undefined && toPos !== undefined) {
			const tr = this.view.state.update({
				changes: { from: fromPos, to: toPos, insert: newImgTagFinal },
				selection: { anchor: this.view.state.selection.main.head },
				userEvent: "image.resize.update",
			});
			this.view.dispatch(tr);
			console.log(
				`图片 "${
					this.draggedImageInfo.path
				}" 样式已更新: ${finalStyleString.trim()}`
			);
		}
		this.resetDragState();
	}
}
