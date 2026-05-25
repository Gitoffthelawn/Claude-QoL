// rich-copy.js
// Adds "Copy as Rich Text" buttons next to copy buttons on Claude's content blocks.
// Copies rendered HTML to clipboard so it pastes with formatting into email, Docs, etc.

(function () {
	'use strict';

	const RICH_COPY_CLASS = 'qol-rich-copy-btn';

	const RICH_COPY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M9 14h6"/><path d="M9 18h6"/><path d="M9 10h6"/></svg>`;

	const CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

	function isMessageActionBar(el) {
		if (!el) return false;
		if (el.dataset?.testid === 'action-bar-copy') return true;
		const group = el.closest('[role="group"][aria-label="Message actions"]');
		return !!group;
	}

	function isCopyButton(btn) {
		const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
		if (ariaLabel.includes('copy')) return true;

		const title = (btn.getAttribute('title') || '').toLowerCase();
		if (title.includes('copy')) return true;

		const testId = btn.dataset?.testid || '';
		if (testId.includes('copy')) return true;

		const textContent = btn.textContent?.trim().toLowerCase() || '';
		if (textContent === 'copy') return true;

		const svg = btn.querySelector('svg');
		if (svg) {
			const markup = svg.outerHTML;
			if (markup.includes('M16 4') || markup.includes('M8 4') || markup.includes('M8 2')) return true;
			const rects = svg.querySelectorAll('rect');
			if (rects.length >= 2) return true;
		}

		return false;
	}

	function findContentBlockCopyButtons() {
		const results = [];
		const allButtons = document.querySelectorAll('button');

		for (const btn of allButtons) {
			if (isMessageActionBar(btn)) continue;
			if (btn.classList.contains(RICH_COPY_CLASS)) continue;
			if (!isCopyButton(btn)) continue;
			if (btn.parentElement?.querySelector('.' + RICH_COPY_CLASS)) continue;
			results.push(btn);
		}

		return results;
	}

	function findContentBlock(copyButton) {
		let el = copyButton.parentElement;
		for (let i = 0; i < 15 && el; i++) {
			if (el.matches('[role="group"][aria-label="Message actions"]')) return null;

			const cls = el.className || '';
			if (typeof cls !== 'string') { el = el.parentElement; continue; }

			const hasBorder = cls.includes('border');
			const hasRounding = cls.includes('rounded');

			if (hasBorder && hasRounding && el.offsetHeight > 60) {
				const textLen = el.textContent?.trim().length || 0;
				if (textLen > 30) return el;
			}

			el = el.parentElement;
		}
		return null;
	}

	function extractContentHtml(contentBlock, copyButton) {
		const clone = contentBlock.cloneNode(true);

		clone.querySelectorAll('button, .' + RICH_COPY_CLASS).forEach(el => el.remove());
		clone.querySelectorAll('svg').forEach(el => el.remove());
		clone.querySelectorAll('a').forEach(a => {
			const text = a.textContent?.trim().toLowerCase() || '';
			if (text.includes('send via') || text.includes('gmail')) a.remove();
		});

		const html = clone.innerHTML
			.replace(/<div[^>]*class="[^"]*(?:action|toolbar|btn-group)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
			.trim();

		return html;
	}

	function getPlainText(contentBlock) {
		const clone = contentBlock.cloneNode(true);
		clone.querySelectorAll('button, svg, .' + RICH_COPY_CLASS).forEach(el => el.remove());
		clone.querySelectorAll('a').forEach(a => {
			const text = a.textContent?.trim().toLowerCase() || '';
			if (text.includes('send via') || text.includes('gmail')) a.remove();
		});
		return clone.textContent?.trim() || '';
	}

	async function copyAsRichText(contentBlock, button) {
		const html = extractContentHtml(contentBlock, button);
		const plainText = getPlainText(contentBlock);

		if (!plainText) {
			showClaudeAlert('Error', 'Could not find content to copy.');
			return;
		}

		try {
			await navigator.clipboard.write([
				new ClipboardItem({
					'text/html': new Blob([html], { type: 'text/html' }),
					'text/plain': new Blob([plainText], { type: 'text/plain' }),
				})
			]);

			const original = button.innerHTML;
			button.innerHTML = CHECK_SVG;
			setTimeout(() => { button.innerHTML = original; }, 1500);
		} catch (err) {
			console.error('[Rich Copy] Clipboard write failed:', err);
			showClaudeAlert('Error', 'Failed to copy rich text to clipboard.');
		}
	}

	function createRichCopyButton(contentBlock) {
		const btn = document.createElement('button');
		btn.className = RICH_COPY_CLASS;
		btn.innerHTML = RICH_COPY_SVG;
		btn.setAttribute('aria-label', 'Copy as rich text');
		btn.style.cssText = 'cursor:pointer; background:none; border:none; color:inherit; padding:4px; display:inline-flex; align-items:center; opacity:0.7; transition:opacity 0.15s;';
		btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
		btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.7'; });
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			copyAsRichText(contentBlock, btn);
		});

		createClaudeTooltip(btn, 'Copy as rich text');

		return btn;
	}

	function injectButtons() {
		const copyButtons = findContentBlockCopyButtons();
		for (const copyBtn of copyButtons) {
			const contentBlock = findContentBlock(copyBtn);
			if (!contentBlock) continue;
			if (contentBlock.querySelector('.' + RICH_COPY_CLASS)) continue;

			const richBtn = createRichCopyButton(contentBlock);
			copyBtn.parentElement.insertBefore(richBtn, copyBtn.nextSibling);
		}
	}

	function initialize() {
		setInterval(injectButtons, 1000);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initialize);
	} else {
		initialize();
	}
})();
