// notifications.js - Notifications Page

window.initNotifications = async function() {
    const pageContent = document.getElementById('pageContent');
    try {
        const isAuth = await window.checkAuth();
        if (!isAuth) return;

        await window.loadNavbar('notifications');
        await window.loadTopbar('notifications');
        await window.loadUserInfo();
        await window.loadNotifications();
        await window.loadNotificationCount();

        const savedTheme = localStorage.getItem('taskflow-theme');
        if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

        renderNotificationsPage();
    } catch (err) {
        console.error('Notifications page init error:', err);
        if (pageContent) pageContent.innerHTML = window.renderEmptyState('❌', 'Error loading notifications', err.message || 'Please try refreshing the page.');
    }
};

function renderNotificationsPage() {
    const pageContent = document.getElementById('pageContent');
    const notifs = window.notifications || [];

    pageContent.innerHTML = `
        <div class="page-head">
            <div>
                <h2>Notifications</h2>
                <p>Stay updated with your tasks and team activity.</p>
            </div>
            <div class="page-actions">
                <button class="btn secondary" id="markAllReadBtn">Mark all as read</button>
            </div>
        </div>

        <div class="card">
            <div class="notification-list">
                ${notifs.length === 0 ? window.renderEmptyState('🔔', 'No notifications', 'You\'re all caught up!') :
                    notifs.map(n => `
                        <div class="notification-item ${n.is_read ? '' : 'unread'}">
                            <div class="notification-icon"><i class="bx ${n.type === 'reminder' ? 'bx-bell' : n.type === 'assignment' ? 'bx-user-plus' : n.type === 'comment' ? 'bx-message' : 'bx-info-circle'}"></i></div>
                            <div style="flex:1;">
                                <h4>${window.escapeHtml(n.title)}</h4>
                                <p>${window.escapeHtml(n.message)}</p>
                                <time>${window.timeAgo(n.created_at)}</time>
                            </div>
                            ${n.is_read ? '' : `<button class="mark-read-btn" data-read="${n.id}">Mark read</button>`}
                        </div>
                    `).join('')
                }
            </div>
        </div>
    `;

    document.getElementById('markAllReadBtn').addEventListener('click', async () => {
        const unreadIds = (window.notifications || []).filter(n => !n.is_read).map(n => n.id);
        if (unreadIds.length === 0) return;
        const { error } = await supabase.from('notifications').update({ is_read: true }).in('id', unreadIds);
        if (error) { console.error(error); window.showToastMsg('Failed to update notifications'); return; }
        window.notifications.forEach(n => n.is_read = true);
        window.loadNotificationCount();
        renderNotificationsPage();
    });

    document.querySelectorAll('[data-read]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.read;
            const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id);
            if (error) { console.error(error); return; }
            const n = window.notifications.find(x => String(x.id) === String(id));
            if (n) n.is_read = true;
            window.loadNotificationCount();
            renderNotificationsPage();
        });
    });
}

// Expose
window.initNotifications = window.initNotifications;
window.renderNotificationsPage = renderNotificationsPage;