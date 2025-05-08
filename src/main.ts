import { Plugin } from "obsidian";
import { ViewPlugin, EditorView, ViewUpdate } from "@codemirror/view";

export default class ObsidianImageEnhancePlugin extends Plugin {
	async onload() {
		console.log("图片悬停插件加载成功!");

		// 实时预览模式 (Live Preview) 的悬停检测 ---
		this.registerEditorExtension(this.createLivePreviewHoverExtension());
	}

	createLivePreviewHoverExtension() {
		// 使用一个类来创建 ViewPlugin，这样可以管理状态和事件监听器
		return ViewPlugin.fromClass(ImageHoverViewPlugin);
	}

	onunload() {
		console.log("图片悬停插件卸载!");
	}
}

class ImageHoverViewPlugin {
	private contentDom: HTMLElement;
	private lastHoveredImg: HTMLImageElement | null = null;

	// 用于存储动态添加到图片上的事件监听器的解绑函数
	private activeImgMouseMoveUnlistener: (() => void) | null = null;
	private activeImgMouseLeaveUnlistener: (() => void) | null = null;

	constructor(private view: EditorView) {
		// 也可以直接用 view，方便访问
		this.contentDom = view.contentDOM;

		// 绑定this上下文
		this.handleContainerMouseMove =
			this.handleContainerMouseMove.bind(this);
		this.handleContainerMouseLeave =
			this.handleContainerMouseLeave.bind(this);

		// 在整个编辑器内容区域监听mousemove和mouseleave
		this.contentDom.addEventListener(
			"mousemove",
			this.handleContainerMouseMove
		);
		this.contentDom.addEventListener(
			"mouseleave",
			this.handleContainerMouseLeave
		);
	}

	// (update(update: ViewUpdate) {} 方法可以保留，未来可能用到)
	update(update: ViewUpdate) {}

	destroy() {
		this.contentDom.removeEventListener(
			"mousemove",
			this.handleContainerMouseMove
		);
		this.contentDom.removeEventListener(
			"mouseleave",
			this.handleContainerMouseLeave
		);
		this.clearActiveImageState(); // 清理可能残留的状态
	}

	/**
	 * 清理当前高亮图片的状态（边框、鼠标指针、特定事件监听器）
	 */
	private clearActiveImageState() {
		if (this.lastHoveredImg) {
			this.lastHoveredImg.classList.remove("image-hover-highlight");
			this.lastHoveredImg.style.cursor = ""; // 恢复默认鼠标指针

			// 移除之前动态添加的事件监听器
			if (this.activeImgMouseMoveUnlistener) {
				this.activeImgMouseMoveUnlistener();
				this.activeImgMouseMoveUnlistener = null;
			}
			if (this.activeImgMouseLeaveUnlistener) {
				this.activeImgMouseLeaveUnlistener();
				this.activeImgMouseLeaveUnlistener = null;
			}
			this.lastHoveredImg = null;
		}
	}

	/**
	 * 处理鼠标在整个编辑器内容DOM上的移动事件 (事件委托)
	 */
	private handleContainerMouseMove(event: MouseEvent) {
		const targetElement = event.target as HTMLElement;
		let currentTargetIsOurImage = false;

		// 检查目标是否是我们关心的图片
		if (
			targetElement.nodeName === "IMG" &&
			targetElement.closest(
				'span.cm-image, div.cm-embed-block[data-embed-type="image"], .cm-widgetImage, .image-embed'
			) &&
			this.contentDom.contains(targetElement)
		) {
			const imgTarget = targetElement as HTMLImageElement;
			currentTargetIsOurImage = true;

			// 如果鼠标移动到了一个新的图片上，或者从非图片区域移动到图片上
			if (this.lastHoveredImg !== imgTarget) {
				this.clearActiveImageState(); // 先清理上一个图片的状态

				imgTarget.classList.add("image-hover-highlight");
				// console.log(`[实时预览] 鼠标进入图片: ${imgTarget.src}`); // 可以保留或按需修改
				this.lastHoveredImg = imgTarget;

				// 给当前高亮的图片动态添加mousemove和mouseleave事件监听
				const onImageMouseMove = (e: MouseEvent) =>
					this.handleImageSpecificMouseMove(e, imgTarget);
				const onImageMouseLeave = (e: MouseEvent) =>
					this.handleImageSpecificMouseLeave(e, imgTarget);

				imgTarget.addEventListener("mousemove", onImageMouseMove);
				imgTarget.addEventListener("mouseleave", onImageMouseLeave);

				// 保存解绑函数
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
			}
			// 如果鼠标仍在之前已高亮的图片上移动，则其自身的 'mousemove' 事件会处理鼠标指针
		}

		// 如果鼠标当前不在任何我们关心的图片上，但之前有高亮过的图片
		if (!currentTargetIsOurImage && this.lastHoveredImg) {
			// 检查鼠标是否真的移出了lastHoveredImg（而不是移到了它的子元素上，虽然img通常没有子元素）
			if (!this.lastHoveredImg.contains(targetElement)) {
				this.clearActiveImageState();
			}
		}
	}

	/**
	 * 处理鼠标离开整个编辑器内容DOM的事件
	 */
	private handleContainerMouseLeave(event: MouseEvent) {
		// 检查鼠标是否确实移出了contentDom区域
		if (
			event.relatedTarget &&
			!this.contentDom.contains(event.relatedTarget as Node)
		) {
			this.clearActiveImageState();
		} else if (!event.relatedTarget) {
			// 如果relatedTarget为null (例如鼠标移出窗口)
			this.clearActiveImageState();
		}
	}

	/**
	 * 处理鼠标在特定高亮图片上移动的事件，用于改变鼠标指针
	 */
	private handleImageSpecificMouseMove(
		event: MouseEvent,
		imgElement: HTMLImageElement
	) {
		const rect = imgElement.getBoundingClientRect();
		const sensitivity = 8; // 边缘检测的灵敏度（像素）

		// 鼠标相对于图片左上角的位置
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;

		let cursorStyle = "auto"; // 默认光标

		// 检查是否在边角或边缘
		const onLeftEdge = x >= 0 && x < sensitivity;
		const onRightEdge = x <= rect.width && x > rect.width - sensitivity;
		const onTopEdge = y >= 0 && y < sensitivity;
		const onBottomEdge = y <= rect.height && y > rect.height - sensitivity;

		if (onTopEdge && onLeftEdge)
			cursorStyle = "nwse-resize"; // 左上角 (西北-东南)
		else if (onTopEdge && onRightEdge)
			cursorStyle = "nesw-resize"; // 右上角 (东北-西南)
		else if (onBottomEdge && onLeftEdge)
			cursorStyle = "nesw-resize"; // 左下角
		else if (onBottomEdge && onRightEdge)
			cursorStyle = "nwse-resize"; // 右下角
		else if (onLeftEdge) cursorStyle = "ew-resize"; // 左边缘 (东西)
		else if (onRightEdge) cursorStyle = "ew-resize"; // 右边缘
		else if (onTopEdge) cursorStyle = "ns-resize"; // 上边缘 (南北)
		else if (onBottomEdge) cursorStyle = "ns-resize"; // 下边缘
		else cursorStyle = "default"; // 在图片内部，但不在边缘，显示默认指针

		imgElement.style.cursor = cursorStyle;
	}

	/**
	 * 处理鼠标离开特定高亮图片的事件
	 */
	private handleImageSpecificMouseLeave(
		event: MouseEvent,
		imgElement: HTMLImageElement
	) {
		// 当鼠标移出图片时，恢复其默认的鼠标指针样式
		// 边框的移除由 handleContainerMouseMove 或 handleContainerMouseLeave 控制
		imgElement.style.cursor = "";
		// console.log(`[实时预览] 鼠标离开图片: ${imgElement.src}`);
	}
}
