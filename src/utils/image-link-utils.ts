import { EditorView } from "@codemirror/view";

/**
 * 从文本行中提取第一个可识别的图片路径。
 * 优先匹配 HTML <img> 标签，然后是 Markdown，最后是 Wikilink。
 * @param textLine 包含图片语法的文本行
 * @returns 图片路径字符串，如果未找到则为 null
 * @deprecated 该函数已被弃用，建议使用 parseImageSyntaxFromLine 函数。
 */
export function extractFirstImagePath(textLine: string): string | null {
	if (!textLine) {
		return null;
	}

	// 1. 尝试匹配 HTML <img> 标签 (包括有无 style 的情况)
	const htmlRegex = /<img\s[^>]*src=(?:["']([^"']+)["']|([^>\s]+))/i;
	let match = textLine.match(htmlRegex);
	if (match && (match[1] || match[2])) {
		return (match[1] || match[2]).trim();
	}

	// 2. 尝试匹配 Markdown 风格链接 `![](path)` 或 `![alt](path "title")`
	const markdownRegex = /!\[[^\]]*\]\(([^)\s]+)(?:\s[^)]*)?\)/;
	match = textLine.match(markdownRegex);
	if (match && match[1]) {
		return match[1].trim();
	}

	// 3. 尝试匹配 Wikilink 风格链接 `![[path]]` 或 `![[path|alias]]`
	const wikilinkRegex = /!\[\[([^|\]]+)(?:\|[^\]]*)?\]\]/;
	match = textLine.match(wikilinkRegex);
	if (match && match[1]) {
		return match[1].trim();
	}

	return null;
}

interface ParsedImageInfo {
	path: string;
	altText?: string;
	specifiedWidth?: number;
	specifiedHeight?: number;
	originalMatch: string; // 完整匹配到的原始Markdown/Wikilink字符串
	startIndexInLine: number; // 原始匹配在行文本中的起始索引
	isHtml: boolean;
	currentZoomPercent?: number; // 当前缩放百分比
}

/**
 * 解析文本行中的图片语法，仅限 Markdown
 * @param lineText 包含图片语法的文本行
 * @returns 匹配结果对象，包含图片路径、alt文本、指定宽高等信息
 */
function parseMarkdown(lineText: string): ParsedImageInfo | null {
	// 优先匹配 Markdown: ![alt|WxH](path) 或 ![alt](path) 或 ![|WxH](path)
	// 组1: Alt Text (可以包含空格，但不能包含 ']')
	// 组2: 尺寸 WxH 或 W (如果组2存在)
	// 组3: 路径
	const markdownRegex = /!\[(.*?)?(?:\|(\d+(?:x\d+)?))?\]\(([^)]+)\)/;
	const match = lineText.match(markdownRegex);

	if (match) {
		const altText = match[1] || undefined; // Obsidian 的 alt 可能  是空的
		const dimensionsString = match[2]; // 例如 "100x200" 或 "100"
		const path = match[3].trim();
		let specifiedWidth: number | undefined;
		let specifiedHeight: number | undefined;

		if (dimensionsString) {
			const dims = dimensionsString.split("x");
			if (dims[0]) {
				specifiedWidth = parseInt(dims[0], 10);
			}
			if (dims.length > 1 && dims[1]) {
				specifiedHeight = parseInt(dims[1], 10);
			}
		}
		return {
			path,
			altText,
			specifiedWidth,
			specifiedHeight,
			originalMatch: match[0],
			startIndexInLine: match.index ?? 0,
			isHtml: false,
		};
	}
	return null;
}

/**
 * 解析文本行中的图片语法，仅限 Wikilink
 * @param lineText 包含图片语法的文本行
 * @returns 匹配结果对象，包含图片路径、alt文本、指定宽高等信息
 */
function parseWikilink(lineText: string): ParsedImageInfo | null {
	// 匹配 Wikilink: ![[path|WxH]] 或 ![[path|W]] 或 ![[path|alt]] 或 ![[path]]
	// 组1: 路径
	// 组2: 管道符后的内容 (alt 或 WxH 或 W) (可选)
	const wikilinkRegex = /!\[\[([^|\]]+)(?:\|([^|\]]*))?\]\]/;
	const match = lineText.match(wikilinkRegex);
	if (match) {
		const path = match[1].trim();
		const altOrDimensions = match[2]; // 可能为 undefined, "alt text", "100", "100x200"
		let specifiedWidth: number | undefined;
		let specifiedHeight: number | undefined;
		let altText: string | undefined = altOrDimensions; // 默认为 alt text

		if (altOrDimensions) {
			const dimMatch = altOrDimensions.match(/^(\d+)(?:x(\d+))?$/); // 严格匹配 WxH 或 W
			if (dimMatch) {
				// 是尺寸字符串
				if (dimMatch[1]) {
					specifiedWidth = parseInt(dimMatch[1], 10);
				}
				if (dimMatch[2]) {
					specifiedHeight = parseInt(dimMatch[2], 10);
				}
				altText = undefined; // 如果是尺寸，则它不是 alt text
			}
		}
		return {
			path,
			altText,
			specifiedWidth,
			specifiedHeight,
			originalMatch: match[0],
			startIndexInLine: match.index ?? 0,
			isHtml: false,
		};
	}
	return null;
}

/**
 * 解析文本行中的 HTML <img> 标签
 * @param lineText 包含图片语法的文本行
 * @returns 匹配结果对象，包含图片路径、alt文本、指定宽高等信息
 */
function parseHtml(lineText: string): ParsedImageInfo | null {
	const htmlImgRegex =
		/(<img\s+(?:[^>]*?\s+)?src=(?:["']([^"']+)["']|([^>\s]+))(?:\s+[^>]*?\s*alt=(?:["']([^"']*)["']|([^>\s]*)))?(?:\s+[^>]*?\s*style=(?:["']([^"']+)["']|([^>\s]+)))?[^>]*?>)/i;
	const htmlMatch = lineText.match(htmlImgRegex);

	if (htmlMatch) {
		const originalHtmlTag = htmlMatch[0]; // 整个匹配到的 <img> 标签
		const path = htmlMatch[2] || htmlMatch[3]; // src 值
		const altText = htmlMatch[4] || htmlMatch[5] || undefined; // alt 值
		const styleString = htmlMatch[6] || htmlMatch[7] || undefined; // style 属性内容

		let specifiedWidth: number | undefined;
		let specifiedHeight: number | undefined;
		let currentZoomP: number | undefined;

		if (styleString) {
			const widthMatch = styleString.match(/width:\s*(\d+)px/i);
			if (widthMatch && widthMatch[1]) {
				specifiedWidth = parseInt(widthMatch[1], 10);
			}

			const heightMatch = styleString.match(/height:\s*(\d+)px/i);
			if (heightMatch && heightMatch[1]) {
				specifiedHeight = parseInt(heightMatch[1], 10);
			}

			const zoomMatch = styleString.match(/zoom:\s*(\d+)%?/i); // zoom值后的 % 是可选的
			if (zoomMatch && zoomMatch[1]) {
				currentZoomP = parseInt(zoomMatch[1], 10);
			}
		}

		if (path) {
			// 必须要有src属性
			return {
				path: path.trim(),
				altText: altText ? altText.trim() : undefined,
				specifiedWidth,
				specifiedHeight,
				currentZoomPercent: currentZoomP,
				isHtml: true,
				originalMatch: originalHtmlTag,
				startIndexInLine: htmlMatch.index ?? 0,
			};
		}
	}

	return null; // 未匹配到可识别的图片语法
}

/**
 * 从文本行中解析图片语法，支持 Markdown、Wikilink 和 HTML <img> 标签。
 * @param lineText 包含图片语法的文本行
 * @returns 匹配结果对象，包含图片路径、alt文本、指定宽高等信息
 */
export function parseImageSyntaxFromLine(
	lineText: string
): ParsedImageInfo | null {
	let result = parseMarkdown(lineText);
	if (result) return result;
	result = parseWikilink(lineText);
	if (result) return result;
	return parseHtml(lineText); // 最后尝试 HTML <img> 标签
}

// 辅助函数: 转义HTML特殊字符 (用于alt属性)
export function escapeHtml(unsafe: string): string {
	return unsafe
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

// 辅助函数: 转义正则表达式特殊字符
export function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 辅助函数：尝试从DOM元素向上追溯，找到其在CodeMirror文档中的位置和对应行的文本
// 这对于处理嵌套在复杂Widget中的图片元素尤其重要
export function getLineInfoFromElement(
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
