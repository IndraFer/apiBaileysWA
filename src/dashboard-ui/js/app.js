/** Main App — SPA Router & Initialization */
(function () {
	const pages = {
		overview: { title: "Overview", render: () => OverviewPage.render() },
		sessions: {
			title: "Sessions",
			render: () => SessionsPage.render(),
			destroy: () => SessionsPage.destroy?.(),
		},
		messaging: { title: "Messaging", render: () => MessagingPage.render() },
		groups: { title: "Groups", render: () => GroupsPage.render() },
		webhooks: { title: "Webhooks", render: () => WebhooksPage.render() },
		events: {
			title: "Event Monitor",
			render: () => EventsPage.render(),
			destroy: () => EventsPage.destroy?.(),
		},
		settings: { title: "Settings", render: () => SettingsPage.render() },
	};

	let currentPage = null;

	window.App = {
		async init() {
			Modal.init();

			// Theme toggle
			document
				.getElementById("theme-toggle")
				.addEventListener("click", () => ThemeManager.toggle());

			// Sidebar navigation
			document.querySelectorAll(".nav-item").forEach((item) => {
				item.addEventListener("click", (e) => {
					e.preventDefault();
					const page = item.dataset.page;
					this.navigate(page);
					// Close mobile sidebar
					document.getElementById("sidebar").classList.remove("open");
				});
			});

			// Mobile hamburger
			document
				.getElementById("hamburger")
				.addEventListener("click", () => {
					document.getElementById("sidebar").classList.toggle("open");
				});
			document
				.getElementById("sidebar-close")
				.addEventListener("click", () => {
					document.getElementById("sidebar").classList.remove("open");
				});

			// Logout
			document
				.getElementById("btn-logout")
				.addEventListener("click", () => {
					API.clearToken();
					localStorage.removeItem("wa-dashboard-user");
					this.showAuth();
					Toast.info("Logged out");
				});

			// Check auth
			const token = API.getToken();
			if (token) {
				const result = await API.get("/auth/me");
				if (result.success) {
					this.showDashboard(result.data);
					return;
				}
			}
			this.showAuth();
		},

		showAuth() {
			document.getElementById("auth-screen").classList.remove("hidden");
			document.getElementById("dashboard").classList.add("hidden");
			AuthUI.init();
		},

		showDashboard(user) {
			document.getElementById("auth-screen").classList.add("hidden");
			document.getElementById("dashboard").classList.remove("hidden");
			this.renderUserBadge(user?.username || "User");

			// Navigate to hash or default
			const hash = window.location.hash.replace("#", "") || "overview";
			this.navigate(hash);
		},

		/** Get initials from username: "admin" → "A", "admin_dashboard" → "AD", "john_doe_smith" → "JD" */
		getInitials(username) {
			const parts = username.split(/[_\-.\s]+/).filter(Boolean);
			if (parts.length >= 2)
				return (parts[0][0] + parts[1][0]).toUpperCase();
			return username.substring(0, 1).toUpperCase();
		},

		/** Deterministic color from username hash */
		getAvatarColor(username) {
			let hash = 0;
			for (let i = 0; i < username.length; i++) {
				hash = username.charCodeAt(i) + ((hash << 5) - hash);
			}
			const hue = Math.abs(hash) % 360;
			return `hsl(${hue}, 65%, 50%)`;
		},

		/** Convert username to Title Case: "admin_dashboard" → "Admin Dashboard" */
		toTitleCase(username) {
			return username
				.split(/[_\-.\s]+/)
				.filter(Boolean)
				.map(
					(w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
				)
				.join(" ");
		},

		renderUserBadge(username) {
			const initials = this.getInitials(username);
			const color = this.getAvatarColor(username);
			const displayName = this.toTitleCase(username);
			const el = document.getElementById("user-badge");
			el.innerHTML = `<div class="user-avatar" style="background:${color}">${initials}</div><span class="user-name">${displayName}</span>`;
		},

		navigate(pageName) {
			// Destroy previous page if has cleanup
			if (currentPage && pages[currentPage]?.destroy) {
				pages[currentPage].destroy();
			}

			const page = pages[pageName];
			if (!page) {
				this.navigate("overview");
				return;
			}

			currentPage = pageName;
			window.location.hash = pageName;

			// Update nav active state
			document.querySelectorAll(".nav-item").forEach((item) => {
				item.classList.toggle("active", item.dataset.page === pageName);
			});

			// Update title
			document.getElementById("page-title").textContent = page.title;

			// Render page
			page.render();
		},
	};

	// Init when DOM ready
	document.addEventListener("DOMContentLoaded", () => App.init());
})();
