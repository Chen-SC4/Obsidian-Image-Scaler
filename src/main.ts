import { Plugin } from "obsidian";
import { ViewPlugin } from "@codemirror/view";
import { ImageHoverViewPlugin } from "./image-hover-view-plugin"; // 导入新的类

export default class ObsidianImageEnhancePlugin extends Plugin {
	async onload() {
		console.log("Image Enhance Version 1.0.0");
		this.registerEditorExtension(this.createLivePreviewHoverExtension());
	}

	createLivePreviewHoverExtension() {
		// 使用一个类来创建 ViewPlugin，这样可以管理状态和事件监听器
		return ViewPlugin.fromClass(ImageHoverViewPlugin);
	}

	onunload() {
		console.log("Unload Image Enhance!");
	}
}
