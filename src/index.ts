import * as postcss from '@kostkams/postcss'
import cssValueParser from 'postcss-value-parser'

import { isCSSFontFaceRule, unescapeStringValue } from './css.js'
import { svgNamespace, xlinkNamespace } from './dom.js'
import { createStackingLayers } from './stacking.js'
import { DomToSvgOptions, walkNode } from './traversal.js'
import { createIdGenerator } from './util.js'

export { DomToSvgOptions }

export function documentToSVG(document: Document, options?: DomToSvgOptions): XMLDocument {
	return elementToSVG(document.documentElement, options)
}

export function elementToSVG(element: Element, options?: DomToSvgOptions): XMLDocument {
	const svgDocument = element.ownerDocument.implementation.createDocument(svgNamespace, 'svg', null)

	const svgElement = (svgDocument.documentElement as unknown) as SVGSVGElement
	svgElement.setAttribute('xmlns', svgNamespace)
	svgElement.setAttribute('xmlns:xlink', xlinkNamespace)
	svgElement.append(
		svgDocument.createComment(
			// "--" is invalid in comments, percent-encode.
			` Generated by dom-to-svg from ${element.ownerDocument.location.href.replace(/--/g, '%2D%2D')} `
		)
	)

	// Copy @font-face rules
	const styleElement = svgDocument.createElementNS(svgNamespace, 'style')
	for (const styleSheet of element.ownerDocument.styleSheets) {
		try {
			// Make font URLs absolute (need to be resolved relative to the stylesheet)
			for (const rule of styleSheet.rules ?? []) {
				if (!isCSSFontFaceRule(rule)) {
					continue
				}
				const styleSheetHref = rule.parentStyleSheet?.href
				if (styleSheetHref) {
					// Note: Firefox does not implement rule.style.src, need to use rule.style.getPropertyValue()
					const parsedSourceValue = cssValueParser(rule.style.getPropertyValue('src'))
					parsedSourceValue.walk(node => {
						if (node.type === 'function' && node.value === 'url' && node.nodes[0]) {
							const urlArgumentNode = node.nodes[0]
							if (urlArgumentNode.type === 'string' || urlArgumentNode.type === 'word') {
								urlArgumentNode.value = new URL(
									unescapeStringValue(urlArgumentNode.value),
									styleSheetHref
								).href
							}
						}
					})
					// Firefox does not support changing `src` on CSSFontFaceRule declarations, need to use PostCSS.
					const updatedFontFaceRule = postcss.parse(rule.cssText)
					updatedFontFaceRule.walkDecls('src', declaration => {
						declaration.value = cssValueParser.stringify(parsedSourceValue.nodes)
					})
					styleElement.append(updatedFontFaceRule.toString() + '\n')
				}
			}
		} catch (error) {
			console.error('Error resolving @font-face src URLs for styleSheet, skipping', styleSheet, error)
		}
	}
	svgElement.append(styleElement)

	walkNode(element, {
		svgDocument,
		currentSvgParent: svgElement,
		stackingLayers: createStackingLayers(svgElement),
		parentStackingLayer: svgElement,
		getUniqueId: createIdGenerator(),
		labels: new Map<HTMLLabelElement, string>(),
		ancestorMasks: [],
		options: {
			captureArea: options?.captureArea ?? element.getBoundingClientRect(),
			keepLinks: options?.keepLinks !== false,
		},
	})

	const bounds = options?.captureArea ?? element.getBoundingClientRect()
	svgElement.setAttribute('width', bounds.width.toString())
	svgElement.setAttribute('height', bounds.height.toString())
	svgElement.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`)

	return svgDocument
}

export { inlineResources } from './inline.js'
