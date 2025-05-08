/**
 * 从给定的文本中提取第一个找到的图片链接的路径。
 * 支持 Markdown 格式 `![alt](path)` 和 Wikilink 格式 `![[path]]` 或 `![[path|alias]]`。
 * @param textLine 包含图片链接的文本行或字符串片段。
 * @returns 如果找到图片路径，则返回该路径字符串；否则返回 null。
 */
/**
 * 从文本行中提取第一个可识别的图片路径。
 * 优先匹配 HTML <img> 标签，然后是 Markdown，最后是 Wikilink。
 * @param textLine 包含图片语法的文本行
 * @returns 图片路径字符串，如果未找到则为 null
 */
export function extractFirstImagePath(textLine: string): string | null {
	if (!textLine) {
		return null;
	}

	// 1. 尝试匹配 HTML <img> 标签 (包括有无 style 的情况)
	//    - src="path"
	//    - src='path'
	//    - src=path (无引号，较少见但技术上可能)
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
