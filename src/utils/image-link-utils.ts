/**
 * 从给定的文本中提取第一个找到的图片链接的路径。
 * 支持 Markdown 格式 `![alt](path)` 和 Wikilink 格式 `![[path]]` 或 `![[path|alias]]`。
 * @param textLine 包含图片链接的文本行或字符串片段。
 * @returns 如果找到图片路径，则返回该路径字符串；否则返回 null。
 */
export function extractFirstImagePath(textLine: string): string | null {
	if (!textLine) {
		return null;
	}
	// 注意：这里不再对整个 textLine 进行 trim()，因为我们要在原始字符串中查找。
	// trim() 会应用到提取出的路径上。

	// 1. 尝试匹配 Markdown 风格链接 (移除了 ^ 和 $)
	const markdownRegex = /!\[[^\]]*\]\(([^)]+)\)/;
	let match = textLine.match(markdownRegex);

	if (match && match[1]) {
		// match[1] 是捕获到的路径
		return match[1].trim();
	}

	// 2. 尝试匹配 Wikilink 风格链接 (移除了 ^ 和 $)
	const wikilinkRegex = /!\[\[([^|\]]+)(?:\|[^\]]*)?\]\]/;
	match = textLine.match(wikilinkRegex);

	if (match && match[1]) {
		// match[1] 是捕获到的路径
		return match[1].trim();
	}

	// 未找到任何可识别的图片链接
	return null;
}
