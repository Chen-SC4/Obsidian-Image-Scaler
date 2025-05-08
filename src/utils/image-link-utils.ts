import { EditorView } from "@codemirror/view";

/**
 * Extracts the first recognizable image path from a text line.
 * Prioritizes matching HTML <img> tags, then Markdown, and finally Wikilinks.
 * @param textLine The text line containing image syntax
 * @returns Image path string, or null if not found
 * @deprecated This function is deprecated, please use parseImageSyntaxFromLine function instead.
 */
export function extractFirstImagePath(textLine: string): string | null {
	if (!textLine) {
		return null;
	}

	// 1. Try to match HTML <img> tags (with or without style)
	const htmlRegex = /<img\s[^>]*src=(?:["']([^"']+)["']|([^>\s]+))/i;
	let match = textLine.match(htmlRegex);
	if (match && (match[1] || match[2])) {
		return (match[1] || match[2]).trim();
	}

	// 2. Try to match Markdown style links `![](path)` or `![alt](path "title")`
	const markdownRegex = /!\[[^\]]*\]\(([^)\s]+)(?:\s[^)]*)?\)/;
	match = textLine.match(markdownRegex);
	if (match && match[1]) {
		return match[1].trim();
	}

	// 3. Try to match Wikilink style links `![[path]]` or `![[path|alias]]`
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
	originalMatch: string; // Complete original Markdown/Wikilink string that was matched
	startIndexInLine: number; // Starting index of the original match in the line text
	isHtml: boolean;
	currentZoomPercent?: number; // Current zoom percentage
}

/**
 * Parses image syntax in text line, Markdown only
 * @param lineText The text line containing image syntax
 * @returns Match result object containing image path, alt text, specified width/height, etc.
 */
function parseMarkdown(lineText: string): ParsedImageInfo | null {
	// Priority matching Markdown: ![alt|WxH](path) or ![alt](path) or ![|WxH](path)
	// Group 1: Alt Text (can contain spaces, but not ']')
	// Group 2: Dimensions WxH or W (if group 2 exists)
	// Group 3: Path
	const markdownRegex = /!\[(.*?)?(?:\|(\d+(?:x\d+)?))?\]\(([^)]+)\)/;
	const match = lineText.match(markdownRegex);

	if (match) {
		const altText = match[1] || undefined; // Obsidian's alt can be empty
		const dimensionsString = match[2]; // For example "100x200" or "100"
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
 * Parses image syntax in text line, Wikilink only
 * @param lineText The text line containing image syntax
 * @returns Match result object containing image path, alt text, specified width/height, etc.
 */
function parseWikilink(lineText: string): ParsedImageInfo | null {
	// Match Wikilink: ![[path|WxH]] or ![[path|W]] or ![[path|alt]] or ![[path]]
	// Group 1: Path
	// Group 2: Content after pipe (alt or WxH or W) (optional)
	const wikilinkRegex = /!\[\[([^|\]]+)(?:\|([^|\]]*))?\]\]/;
	const match = lineText.match(wikilinkRegex);
	if (match) {
		const path = match[1].trim();
		const altOrDimensions = match[2]; // Could be undefined, "alt text", "100", "100x200"
		let specifiedWidth: number | undefined;
		let specifiedHeight: number | undefined;
		let altText: string | undefined = altOrDimensions; // Default to alt text

		if (altOrDimensions) {
			const dimMatch = altOrDimensions.match(/^(\d+)(?:x(\d+))?$/); // Strict match for WxH or W
			if (dimMatch) {
				// It's a dimension string
				if (dimMatch[1]) {
					specifiedWidth = parseInt(dimMatch[1], 10);
				}
				if (dimMatch[2]) {
					specifiedHeight = parseInt(dimMatch[2], 10);
				}
				altText = undefined; // If it's a dimension, it's not alt text
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
 * Parses HTML <img> tags in text line
 * @param lineText The text line containing image syntax
 * @returns Match result object containing image path, alt text, specified width/height, etc.
 */
function parseHtml(lineText: string): ParsedImageInfo | null {
	const htmlImgRegex =
		/(<img\s+(?:[^>]*?\s+)?src=(?:["']([^"']+)["']|([^>\s]+))(?:\s+[^>]*?\s*alt=(?:["']([^"']*)["']|([^>\s]*)))?(?:\s+[^>]*?\s*style=(?:["']([^"']+)["']|([^>\s]+)))?[^>]*?>)/i;
	const htmlMatch = lineText.match(htmlImgRegex);

	if (htmlMatch) {
		const originalHtmlTag = htmlMatch[0]; // The entire matched <img> tag
		const path = htmlMatch[2] || htmlMatch[3]; // src value
		const altText = htmlMatch[4] || htmlMatch[5] || undefined; // alt value
		const styleString = htmlMatch[6] || htmlMatch[7] || undefined; // style attribute content

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

			const zoomMatch = styleString.match(/zoom:\s*(\d+)%?/i); // The % after zoom value is optional
			if (zoomMatch && zoomMatch[1]) {
				currentZoomP = parseInt(zoomMatch[1], 10);
			}
		}

		if (path) {
			// Must have src attribute
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

	return null; // No recognizable image syntax matched
}

/**
 * Parses image syntax from text line, supporting Markdown, Wikilink, and HTML <img> tags.
 * @param lineText The text line containing image syntax
 * @returns Match result object containing image path, alt text, specified width/height, etc.
 */
export function parseImageSyntaxFromLine(
	lineText: string
): ParsedImageInfo | null {
	let result = parseMarkdown(lineText);
	if (result) return result;
	result = parseWikilink(lineText);
	if (result) return result;
	return parseHtml(lineText); // Finally, try HTML <img> tags
}

// Helper function: Escape HTML special characters (for alt attribute)
export function escapeHtml(unsafe: string): string {
	return unsafe
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

// Helper function: Escape regular expression special characters
export function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Helper function: Try to trace upwards from a DOM element to find its position in the CodeMirror document and the corresponding line text
// This is especially important for handling image elements nested in complex Widgets
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
		console.log("Successfully got line info:", line, pos);
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

export interface LineDetails {
	pos: number;
	lineText: string;
	lineFrom: number;
	lineTo: number;
}

export interface ImageSyntaxInfo {
	path: string | null;
	altText?: string;
	isHtml: boolean;
	specifiedWidth?: number;
	specifiedHeight?: number;
	currentZoomPercent?: number;
	originalMatch: string;
	startIndexInLine: number;
}
