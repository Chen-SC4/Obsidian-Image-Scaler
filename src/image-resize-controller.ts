import { EditorView, ViewUpdate } from "@codemirror/view";
import {
	parseImageSyntaxFromLine,
	escapeHtml,
	escapeRegExp,
	LineDetails,
	ImageSyntaxInfo,
} from "./utils";

export class ImageResizeController {
	private isDragging = false;
	private initialImageWidth = 0;
	private initialImageHeight = 0;
	private currentZoomPercent = 100;
	private lineInfoAtDragStart: LineDetails | null = null;
	private draggedImageInfo: {
		path: string | null;
		altText?: string;
		sourceWidth?: number;
		sourceHeight?: number;
	} | null = null;
	private imageCenterX = 0;
	private imageCenterY = 0;
	private initialDistanceToCenter = 0;

	private activeImgElement: HTMLImageElement | null = null; // 当前正在操作的图片元素

	constructor(private view: EditorView) {
		this.handleDocumentMouseMove = this.handleDocumentMouseMove.bind(this);
		this.handleDocumentMouseUp = this.handleDocumentMouseUp.bind(this);
	}

	public getIsDragging(): boolean {
		return this.isDragging;
	}

	public startResize(
		event: MouseEvent,
		imgElement: HTMLImageElement,
		lineInfo: LineDetails,
		parsedInfo: ImageSyntaxInfo
	) {
		event.preventDefault();
		event.stopPropagation();

		this.activeImgElement = imgElement;
		this.lineInfoAtDragStart = lineInfo;

		this.draggedImageInfo = {
			path: parsedInfo.path,
			altText: parsedInfo.altText,
			sourceWidth: parsedInfo.specifiedWidth,
			sourceHeight: parsedInfo.specifiedHeight,
		};

		if (parsedInfo.specifiedWidth) {
			this.initialImageWidth = parsedInfo.specifiedWidth;
		} else {
			this.initialImageWidth = imgElement.offsetWidth;
		}
		if (!this.initialImageWidth || this.initialImageWidth <= 0)
			this.initialImageWidth = 200;

		const rect = imgElement.getBoundingClientRect();
		this.imageCenterX = rect.left + rect.width / 2;
		this.imageCenterY = rect.top + rect.height / 2;
		const initialDxToCenter = event.clientX - this.imageCenterX;
		const initialDyToCenter = event.clientY - this.imageCenterY;
		this.initialDistanceToCenter = Math.sqrt(
			initialDxToCenter * initialDxToCenter +
				initialDyToCenter * initialDyToCenter
		);

		if (parsedInfo.isHtml) {
			this.currentZoomPercent =
				parsedInfo.currentZoomPercent !== undefined
					? parsedInfo.currentZoomPercent
					: 100;
		} else {
			this.currentZoomPercent = 100;
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

			const from = lineInfo.lineFrom + parsedInfo.startIndexInLine;
			const to = from + parsedInfo.originalMatch.length;

			const tr = this.view.state.update({
				changes: { from, to, insert: newImgTag },
				selection: {
					anchor: this.view.state.selection.main.head,
				},
				userEvent: "image.resize.convert",
			});
			this.view.dispatch(tr);
		}

		this.isDragging = true;
		document.addEventListener("mousemove", this.handleDocumentMouseMove);
		document.addEventListener("mouseup", this.handleDocumentMouseUp);
	}

	private handleDocumentMouseMove(event: MouseEvent) {
		if (
			!this.isDragging ||
			!this.activeImgElement ||
			!this.lineInfoAtDragStart ||
			!this.draggedImageInfo?.path
		) {
			this.resetState();
			return;
		}
		event.preventDefault();
		event.stopPropagation();

		const currentMouseX = event.clientX;
		const currentMouseY = event.clientY;
		const dxToCenterCurrent = currentMouseX - this.imageCenterX;
		const dyToCenterCurrent = currentMouseY - this.imageCenterY;
		const currentDistanceToCenter = Math.sqrt(
			dxToCenterCurrent * dxToCenterCurrent +
				dyToCenterCurrent * dyToCenterCurrent
		);
		const distanceChange =
			currentDistanceToCenter - this.initialDistanceToCenter;
		const zoomSensitivity = 0.2;
		const zoomDelta = distanceChange * zoomSensitivity;
		let newZoom = Math.round(this.currentZoomPercent + zoomDelta);
		newZoom = Math.max(10, Math.min(newZoom, 500));

		this.activeImgElement.style.zoom = `${newZoom}%`;
	}

	private handleDocumentMouseUp(event: MouseEvent) {
		if (
			!this.isDragging ||
			!this.activeImgElement ||
			!this.lineInfoAtDragStart ||
			!this.draggedImageInfo
		) {
			this.resetState();
			return;
		}
		event.preventDefault();
		event.stopPropagation();

		const finalZoomMatch = this.activeImgElement.style.zoom.match(/(\d+)/);
		let finalZoomPercent = this.currentZoomPercent;
		if (finalZoomMatch && finalZoomMatch[1]) {
			finalZoomPercent = parseInt(finalZoomMatch[1], 10);
		}
		finalZoomPercent = Math.max(10, Math.min(finalZoomPercent, 500));
		// console.log(`拖拽结束，最终缩放: ${finalZoomPercent}%`);

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

		const { lineFrom } = this.lineInfoAtDragStart;
		const currentLineContent = this.view.state.doc.lineAt(lineFrom).text;
		const imgTagToReplaceRegex = new RegExp(
			`<img\\s+src=(?:["']${escapeRegExp(
				this.draggedImageInfo.path ?? ""
			)}["']|${escapeRegExp(this.draggedImageInfo.path ?? "")})` +
				`[^>]*>`,
			"i"
		);

		const matchForUpdate = currentLineContent.match(imgTagToReplaceRegex);
		let fromPos: number | undefined, toPos: number | undefined;

		if (matchForUpdate && matchForUpdate.index !== undefined) {
			fromPos = lineFrom + matchForUpdate.index;
			toPos = fromPos + matchForUpdate[0].length;
		} else {
			const originalSyntaxInfo = parseImageSyntaxFromLine(
				this.lineInfoAtDragStart.lineText
			);
			if (
				originalSyntaxInfo &&
				originalSyntaxInfo.path === this.draggedImageInfo.path
			) {
				// console.log("MouseUp: 尝试使用原始Markdown/Wikilink位置进行替换。");
				fromPos = lineFrom + originalSyntaxInfo.startIndexInLine;
				toPos = fromPos + originalSyntaxInfo.originalMatch.length;
			} else {
				// console.warn(
				// 	`MouseUp: 无法在行中找到要更新的 <img /> 标签。行内容: "${currentLineContent}", 期望路径: ${this.draggedImageInfo.path}`
				// );
				this.resetState();
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
		}
		this.resetState();
	}

	public resetState() {
		this.isDragging = false;
		document.removeEventListener("mousemove", this.handleDocumentMouseMove);
		document.removeEventListener("mouseup", this.handleDocumentMouseUp);
		this.lineInfoAtDragStart = null;
		this.draggedImageInfo = null;
		if (this.activeImgElement) {
			this.activeImgElement.style.cursor = "default";
		}
		this.activeImgElement = null;
		// console.log("拖拽状态已重置。");
	}

	public update(
		update: ViewUpdate,
		currentHoveredImg: HTMLImageElement | null
	) {
		if (this.isDragging && update.docChanged) {
			const imgElement = this.activeImgElement; // Use the image active at drag start
			if (imgElement && !document.body.contains(imgElement)) {
				// console.log("拖拽中的图片元素已从文档中移除，重置拖拽状态。");
				this.resetState();
			} else if (this.lineInfoAtDragStart) {
				try {
					const currentLine = this.view.state.doc.lineAt(
						this.lineInfoAtDragStart.pos
					);
					if (
						currentLine.text !== this.lineInfoAtDragStart.lineText
					) {
						// Consider if reset is always needed or if it can adapt
					}
				} catch (e) {
					this.resetState();
				}
			}
		}
	}

	public destroy() {
		document.removeEventListener("mousemove", this.handleDocumentMouseMove);
		document.removeEventListener("mouseup", this.handleDocumentMouseUp);
		// console.log("ImageResizeController destroyed.");
	}
}
