import { EditorView, ViewUpdate } from "@codemirror/view";
import { ImageHoverController } from "./image-hover-controller";
import { ImageResizeController } from "./image-resize-controller";

export class ImageHoverViewPlugin {
	private contentDom: HTMLElement;
	private hoverController: ImageHoverController;
	private resizeController: ImageResizeController;

	constructor(private view: EditorView) {
		this.contentDom = view.contentDOM;

		this.resizeController = new ImageResizeController(view);
		this.hoverController = new ImageHoverController(
			view,
			this.contentDom,
			this.resizeController
		);

		// Bind methods from hoverController for event listeners
		this.handleContainerMouseMove =
			this.hoverController.handleContainerMouseMove.bind(
				this.hoverController
			);
		this.handleContainerMouseLeave =
			this.hoverController.handleContainerMouseLeave.bind(
				this.hoverController
			);

		this.contentDom.addEventListener(
			"mousemove",
			this.handleContainerMouseMove
		);
		this.contentDom.addEventListener(
			"mouseleave",
			this.handleContainerMouseLeave
		);
	}

	// Bound methods for event listeners to ensure `this` context
	private handleContainerMouseMove: (event: MouseEvent) => void;
	private handleContainerMouseLeave: (event: MouseEvent) => void;

	update(update: ViewUpdate) {
		this.resizeController.update(
			update,
			this.hoverController.getLastHoveredImg()
		);
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

		this.hoverController.destroy();
		this.resizeController.destroy();
	}
}
