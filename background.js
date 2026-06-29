// background.js
if (typeof importScripts !== 'undefined') {
	importScripts('lib/jszip.min.js');
}

if (chrome.action) {
	chrome.action.onClicked.addListener((tab) => {
		chrome.tabs.create({ url: 'https://ko-fi.com/lugia19' });
	});
}

// ======== GDPR export download (signed-URL flow) ========
// Claude's claude.ai API calls (export_data / export_signed_url) are made by the content
// script, where the page's first-party session cookies apply. The background only handles the
// storage.googleapis.com signed URLs — those are CORS-blocked from the page but allowed here via
// host_permissions — fetching the manifest JSON and unzipping each batch ZIP with JSZip.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	// Fetch a (CORS-restricted) GCS signed URL and return the parsed manifest JSON.
	if (message.type === 'GDPR_FETCH_MANIFEST') {
		(async () => {
			try {
				const response = await fetch(message.url);
				if (!response.ok) {
					throw new Error(`Manifest download failed: ${response.status}`);
				}
				const manifest = JSON.parse(await response.text());
				sendResponse({ success: true, manifest });
			} catch (error) {
				console.error('[Background] Manifest fetch failed:', error);
				sendResponse({ success: false, error: error.message });
			}
		})();
		return true; // Keep channel open for async response
	}

	// Download + unzip each batch ZIP (by signed GCS URL), then stream conversations back.
	if (message.type === 'DOWNLOAD_GDPR_EXPORT') {
		const tabId = sender.tab && sender.tab.id;
		console.log('[Background] Downloading', (message.zipUrls || []).length, 'export batch(es)');

		(async () => {
			let conversations;
			try {
				conversations = [];
				for (let i = 0; i < message.zipUrls.length; i++) {
					console.log('[Background] Downloading batch', i);
					const zipResponse = await fetch(message.zipUrls[i]);
					if (!zipResponse.ok) {
						throw new Error(`Batch ${i} download failed: ${zipResponse.status}`);
					}
					const zip = await JSZip.loadAsync(await zipResponse.arrayBuffer());
					const conversationsFile = zip.file('conversations.json');
					if (!conversationsFile) {
						throw new Error(`conversations.json not found in batch ${i}`);
					}
					const batch = JSON.parse(await conversationsFile.async('text'));
					conversations.push(...batch);
					console.log('[Background] Batch', i, ':', batch.length, 'conversations');
				}
			} catch (error) {
				console.error('[Background] Download failed:', error);
				sendResponse({ success: false, error: error.message });
				return;
			}

			console.log('[Background] Total conversations:', conversations.length);
			// Resolve the content script's await first, then stream the data separately.
			sendResponse({ success: true, totalCount: conversations.length });

			if (!tabId) {
				console.error('[Background] No sender tab to stream batches to');
				return;
			}

			try {
				const BATCH_SIZE = 50;
				for (let i = 0; i < conversations.length; i += BATCH_SIZE) {
					chrome.tabs.sendMessage(tabId, {
						type: 'GDPR_BATCH',
						batch: conversations.slice(i, i + BATCH_SIZE),
						index: i,
						total: conversations.length
					});
					// Small delay to avoid overwhelming
					await new Promise(resolve => setTimeout(resolve, 30));
				}
				// Authoritative completion signal.
				chrome.tabs.sendMessage(tabId, { type: 'GDPR_COMPLETE' });
				console.log('[Background] All batches sent');
			} catch (error) {
				console.error('[Background] Streaming failed:', error);
				chrome.tabs.sendMessage(tabId, { type: 'GDPR_ERROR', error: error.message });
			}
		})();

		return true; // Keep channel open for async response
	}
});