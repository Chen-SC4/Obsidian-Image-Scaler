import { Plugin } from "obsidian";
import { ViewPlugin, EditorView } from "@codemirror/view";

export default class ObsidianImageEnhancePlugin extends Plugin {
	async onload() {
		console.log("图片悬停插件加载成功!");

		// 实时预览模式 (Live Preview) 的悬停检测 ---
		this.registerEditorExtension(this.createLivePreviewHoverExtension());
	}

	createLivePreviewHoverExtension() {
		// 使用一个类来创建 ViewPlugin，这样可以管理状态和事件监听器
		return ViewPlugin.fromClass(
			class ImageHoverViewPlugin {
				private contentDom: HTMLElement; // 编辑器的内容 DOM

				constructor(view: EditorView) {
					// 保存对编辑器内容 DOM 的引用
					this.contentDom = view.contentDOM;
					// 绑定 handleMouseOver 方法的 this 上下文
					this.handleMouseOver = this.handleMouseOver.bind(this);
					// 在编辑器的内容 DOM 上监听 mouseover 事件 (事件委托)
					this.contentDom.addEventListener(
						"mouseover",
						this.handleMouseOver
					);
				}

				// 当插件或编辑器视图更新时调用 (这里暂时用不到)
				// update(update: ViewUpdate) {}

				// 当插件被销毁或编辑器视图被销毁时调用
				destroy() {
					this.contentDom.removeEventListener(
						"mouseover",
						this.handleMouseOver
					);
				}

				private handleMouseOver(event: MouseEvent) {
					const targetElement = event.target as HTMLElement;

					// 检查事件目标是否是一个 IMG 标签
					if (targetElement && targetElement.nodeName === "IMG") {
						// 进一步检查这个图片是否是 Obsidian 在实时预览中渲染的 Markdown 图片
						// 这有助于排除非文档内容的图片（例如其他插件的UI图片）
						// 常见的选择器有：
						// - span.cm-image (Markdown 链接 `![alt](src)`)
						// - div.cm-embed-block[data-embed-type="image"] (Wikilink 嵌入 `![[file.png]]`)
						// - img.cm-widgetImage (CodeMirror 图像小部件)
						// - img.image-embed (Obsidian 内部图片嵌入的类)
						if (
							targetElement.closest(
								'span.cm-image, div.cm-embed-block[data-embed-type="image"], .cm-widgetImage, .image-embed'
							)
						) {
							// 确保图片确实在当前 ViewPlugin 实例管理的 contentDom 内
							if (this.contentDom.contains(targetElement)) {
								const imgSrc = (
									targetElement as HTMLImageElement
								).src;
								console.log(
									`[实时预览] 鼠标悬停在图片上: ${imgSrc}`
								);
								// 未来可以在这里添加/移除 CSS 类
								// targetElement.classList.add('image-hover-highlight');
							}
						}
					}
				}
			}
		);
	}

	onunload() {
		console.log("图片悬停插件卸载!");
	}
}
