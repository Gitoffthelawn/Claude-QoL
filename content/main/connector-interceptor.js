// connector-interceptor.js
// Hides the encryption key connector from the MCP bootstrap stream and connector lists.
(function() {
	'use strict';

	const HIDDEN_CONNECTOR_NAME = 'QOL_ENCRYPTIONKEY_DO_NOT_DELETE';

	// ======== EventSource interception (SSE bootstrap stream) ========

	const OriginalEventSource = window.EventSource;
	let hiddenUuid = null;

	window.EventSource = function(url, config) {
		const es = new OriginalEventSource(url, config);

		if (typeof url === 'string' && url.includes('/mcp/v2/bootstrap')) {
			console.log('[ConnectorInterceptor] Intercepting EventSource bootstrap stream');

			// server_base: individual server info — block our connector
			es.addEventListener('server_base', function(event) {
				try {
					const data = JSON.parse(event.data);
					if (data.name === HIDDEN_CONNECTOR_NAME) {
						hiddenUuid = data.uuid;
						console.log('[ConnectorInterceptor] Hiding connector (server_base):', hiddenUuid);
						event.stopImmediatePropagation();
					}
				} catch (e) {}
			});

			// tools/resources/prompts: block if for our connector
			for (const type of ['tools', 'resources', 'prompts']) {
				es.addEventListener(type, function(event) {
					try {
						const data = JSON.parse(event.data);
						if (data.server_uuid && data.server_uuid === hiddenUuid) {
							event.stopImmediatePropagation();
						}
					} catch (e) {}
				});
			}

			// server_list: filter our connector from the summary array
			es.addEventListener('server_list', function(event) {
				if (event._connectorFiltered) return;
				try {
					const data = JSON.parse(event.data);
					if (data.servers && Array.isArray(data.servers)) {
						const before = data.servers.length;
						data.servers = data.servers.filter(s => s.name !== HIDDEN_CONNECTOR_NAME);
						if (data.servers.length !== before) {
							console.log('[ConnectorInterceptor] Filtered connector from server_list');
							event.stopImmediatePropagation();
							const newEvent = new MessageEvent('server_list', { data: JSON.stringify(data) });
							newEvent._connectorFiltered = true;
							es.dispatchEvent(newEvent);
						}
					}
				} catch (e) {}
			});
		}

		return es;
	};
	window.EventSource.prototype = OriginalEventSource.prototype;
	window.EventSource.CONNECTING = OriginalEventSource.CONNECTING;
	window.EventSource.OPEN = OriginalEventSource.OPEN;
	window.EventSource.CLOSED = OriginalEventSource.CLOSED;

	// ======== Fetch interception (JSON list endpoint) ========

	const originalFetch = window.fetch;
	window.fetch = async (...args) => {
		const [input, config] = args;

		let url = undefined;
		if (input instanceof URL) {
			url = input.href;
		} else if (typeof input === 'string') {
			url = input;
		} else if (input instanceof Request) {
			url = input.url;
		}

		if (url && url.includes('/mcp/remote_servers') && (!config?.method || config.method === 'GET')) {
			console.log('[ConnectorInterceptor] Intercepting remote_servers JSON list');
			const response = await originalFetch(...args);
			if (!response.ok) return response;

			try {
				const data = await response.clone().json();
				if (Array.isArray(data)) {
					const filtered = data.filter(c => c.name !== HIDDEN_CONNECTOR_NAME);
					console.log(`[ConnectorInterceptor] Filtered ${data.length - filtered.length} hidden connector(s) from JSON list`);
					return new Response(JSON.stringify(filtered), {
						status: response.status,
						statusText: response.statusText,
						headers: response.headers
					});
				}
			} catch (e) {
				console.warn('[ConnectorInterceptor] Failed to parse remote_servers response:', e.message);
			}
			return response;
		}

		return originalFetch(input, config);
	};
})();
