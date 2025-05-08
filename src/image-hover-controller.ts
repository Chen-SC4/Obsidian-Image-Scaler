import { EditorView } from "@codemirror/view";
import { ImageResizeController } from "./image-resize-controller";
import { parseImageSyntaxFromLine, getLineInfoFromElement } from "./utils";

export class ImageHoverController {
	private lastHoveredImg: HTMLImageElement | null = null;
	private activeImgMouseMoveUnlistener: (() => void) | null = null;
	private activeImgMouseLeaveUnlistener: (() => void) | null = null;
	private activeImgMouseDownUnlistener: (() => void) | null = null;

	constructor(
		private view: EditorView,
		private contentDom: HTMLElement,
		private resizeController: ImageResizeController
	) {
		this.handleImageSpecificMouseMove =
			this.handleImageSpecificMouseMove.bind(this);
		this.handleImageSpecificMouseLeave =
			this.handleImageSpecificMouseLeave.bind(this);
		this.handleImageSpecificMouseDown =
			this.handleImageSpecificMouseDown.bind(this);
	}

	public getLastHoveredImg(): HTMLImageElement | null {
		return this.lastHoveredImg;
	}

	public handleContainerMouseMove(event: MouseEvent) {
		if (this.resizeController.getIsDragging()) return;

		const targetElement = event.target as HTMLElement;
		let currentTargetIsOurImage = false;
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
				this.clearActiveImageState();
				this.lastHoveredImg = imgTarget;
				imgTarget.classList.add("image-hover-highlight");

				imgTarget.addEventListener(
					"mousemove",
					this.handleImageSpecificMouseMove
				);
				imgTarget.addEventListener(
					"mouseleave",
					this.handleImageSpecificMouseLeave
				);
				imgTarget.addEventListener(
					"mousedown",
					this.handleImageSpecificMouseDown
				);

				this.activeImgMouseMoveUnlistener = () =>
					imgTarget.removeEventListener(
						"mousemove",
						this.handleImageSpecificMouseMove
					);
				this.activeImgMouseLeaveUnlistener = () =>
					imgTarget.removeEventListener(
						"mouseleave",
						this.handleImageSpecificMouseLeave
					);
				this.activeImgMouseDownUnlistener = () =>
					imgTarget.removeEventListener(
						"mousedown",
						this.handleImageSpecificMouseDown
					);
			}
		}

		if (!currentTargetIsOurImage && this.lastHoveredImg) {
			if (!this.lastHoveredImg.contains(targetElement)) {
				this.clearActiveImageState();
			}
		}
	}

	public handleContainerMouseLeave(event: MouseEvent) {
		if (this.resizeController.getIsDragging()) return;

		const relatedTargetIsOutside =
			!event.relatedTarget ||
			!this.contentDom.contains(event.relatedTarget as Node);
		if (relatedTargetIsOutside) {
			this.clearActiveImageState();
		}
	}

	private handleImageSpecificMouseMove(event: MouseEvent) {
		const imgElement = event.currentTarget as HTMLImageElement;
		if (this.resizeController.getIsDragging()) {
			return;
		}
		const rect = imgElement.getBoundingClientRect();
		const sensitivity = 8;
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;

		let cursorStyle = "grab";
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

	private handleImageSpecificMouseLeave(event: MouseEvent) {
		const imgElement = event.currentTarget as HTMLImageElement;
		if (!this.resizeController.getIsDragging()) {
			imgElement.style.cursor = "";
		}
	}

	private handleImageSpecificMouseDown(event: MouseEvent) {
		const imgElement = event.currentTarget as HTMLImageElement;
		const cursorStyle = imgElement.style.cursor;

		if (cursorStyle && cursorStyle.includes("-resize")) {
			const lineInfo = getLineInfoFromElement(this.view, imgElement);
			if (!lineInfo) {
				// console.warn("Mousedown: 无法获取图片所在行的信息。");
				return;
			}

			const parsedInfo = parseImageSyntaxFromLine(lineInfo.lineText);
			if (!parsedInfo) {
				// console.warn(
				// 	"Mousedown: 无法解析行中的任何图片语法:",
				// 	lineInfo.lineText
				// );
				return;
			}
			this.resizeController.startResize(
				event,
				imgElement,
				lineInfo,
				parsedInfo
			);
		}
	}

	public clearActiveImageState() {
		if (this.lastHoveredImg) {
			this.lastHoveredImg.classList.remove("image-hover-highlight");
			this.lastHoveredImg.style.cursor = "";

			if (this.activeImgMouseMoveUnlistener)
				this.activeImgMouseMoveUnlistener();
			if (this.activeImgMouseLeaveUnlistener)
				this.activeImgMouseLeaveUnlistener();
			if (this.activeImgMouseDownUnlistener)
				this.activeImgMouseDownUnlistener();

			this.activeImgMouseMoveUnlistener = null;
			this.activeImgMouseLeaveUnlistener = null;
			this.activeImgMouseDownUnlistener = null;
			this.lastHoveredImg = null;
		}
		if (this.resizeController.getIsDragging()) {
			this.resizeController.resetState();
		}
	}

	public destroy() {
		this.clearActiveImageState();
	}
}
