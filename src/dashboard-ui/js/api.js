/** API Client — wraps fetch with auth token */
(function () {
	const BASE = "/dashboard/api";

	window.API = {
		getToken() {
			return localStorage.getItem("wa-dashboard-token");
		},
		setToken(token) {
			localStorage.setItem("wa-dashboard-token", token);
		},
		clearToken() {
			localStorage.removeItem("wa-dashboard-token");
		},

		async request(path, options = {}) {
			const token = this.getToken();
			const headers = {
				"Content-Type": "application/json",
				...(options.headers || {}),
			};
			if (token) headers["Authorization"] = `Bearer ${token}`;

			const res = await fetch(`${BASE}${path}`, { ...options, headers });
			const data = await res
				.json()
				.catch(() => ({ success: false, message: "Network error" }));

			if (
				res.status === 401 &&
				path !== "/auth/login" &&
				path !== "/auth/register" &&
				path !== "/auth/status"
			) {
				this.clearToken();
				window.App?.showAuth();
			}
			return data;
		},

		get(path) {
			return this.request(path);
		},
		post(path, body) {
			return this.request(path, {
				method: "POST",
				body: JSON.stringify(body),
			});
		},
		put(path, body) {
			return this.request(path, {
				method: "PUT",
				body: JSON.stringify(body),
			});
		},
		del(path) {
			return this.request(path, { method: "DELETE" });
		},
	};
})();
