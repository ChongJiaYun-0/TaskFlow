// profile.js - Profile Page

window.initProfile = async function() {
    const pageContent = document.getElementById('pageContent');
    try {
        const isAuth = await window.checkAuth();
        if (!isAuth) return;

        await window.loadNavbar('profile');
        await window.loadTopbar('profile');
        await window.loadUserInfo();
        await window.loadNotificationCount();

        const savedTheme = localStorage.getItem('taskflow-theme');
        if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

        renderProfilePage();
    } catch (err) {
        console.error('Profile page init error:', err);
        if (pageContent) pageContent.innerHTML = window.renderEmptyState('❌', 'Error loading profile', err.message || 'Please try refreshing the page.');
    }
};

function renderProfilePage() {
    const pageContent = document.getElementById('pageContent');
    const user = window.currentUser;
    const profile = window.userProfile;
    const fullName = profile?.full_name || user?.user_metadata?.full_name || 'User';
    const email = profile?.email || user?.email || '';
    const initials = fullName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
    const createdAt = user?.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not available';

    pageContent.innerHTML = `
        <div class="profile-container">
            <div class="profile-header">
                <div class="profile-avatar-wrapper">
                    <div class="avatar-large" id="profileAvatar">${initials}</div>
                </div>
                <div class="profile-info">
                    <h2 id="profileDisplayName">${window.escapeHtml(fullName)}</h2>
                    <p id="profileDisplayEmail">${window.escapeHtml(email)}</p>
                </div>
            </div>

            <form class="profile-settings card" id="profileSettingsForm">
                <div class="card-head">
                    <div>
                        <h3>Profile Settings</h3>
                        <p>Manage your account details.</p>
                    </div>
                </div>
                <div class="profile-settings-body">
                    <div class="profile-detail-grid">
                        <div class="profile-detail">
                            <span class="detail-label">Account ID</span>
                            <strong>${window.escapeHtml(user?.id || 'Not available')}</strong>
                        </div>
                        <div class="profile-detail">
                            <span class="detail-label">Member Since</span>
                            <strong>${createdAt}</strong>
                        </div>
                    </div>
                    <div class="profile-edit-fields">
                        <div class="form-Group">
                            <label for="profileFullName">Full Name</label>
                            <input id="profileFullName" name="full_name" type="text" value="${window.escapeHtml(fullName)}" required>
                        </div>
                        <div class="form-Group">
                            <label for="profileEmail">Email Address</label>
                            <input id="profileEmail" name="email" type="email" value="${window.escapeHtml(email)}" required>
                        </div>
                    </div>
                    <p class="profile-settings-message" id="profileSettingsMessage" role="status"></p>
                    <div class="profile-settings-actions">
                        <button class="btn primary" type="submit"><i class="bx bx-save"></i> Save Changes</button>
                    </div>
                </div>
            </form>
        </div>
    `;

    bindProfileEvents({ fullName, email });
}

function bindProfileEvents(initialValues) {
    const form = document.getElementById('profileSettingsForm');
    const message = document.getElementById('profileSettingsMessage');

    form?.addEventListener('submit', async event => {
        event.preventDefault();
        const fullName = document.getElementById('profileFullName').value.trim();
        const email = document.getElementById('profileEmail').value.trim();
        if (!fullName || !email) return;

        const saveButton = form.querySelector('button[type="submit"]');
        saveButton.disabled = true;
        message.textContent = 'Saving changes...';
        message.className = 'profile-settings-message';
        try {
            const { error: profileError } = await supabase
                .from('profiles')
                .upsert({ id: window.currentUser.id, full_name: fullName, email }, { onConflict: 'id' });
            if (profileError) throw profileError;

            if (email !== (window.currentUser.email || '')) {
                const { error: authError } = await supabase.auth.updateUser({ email });
                if (authError) throw authError;
            }

            window.userProfile = { ...(window.userProfile || {}), full_name: fullName, email };
            await window.loadUserInfo();
            message.textContent = email !== (window.currentUser.email || '')
                ? 'Saved. Check your new email for a confirmation link.'
                : 'Profile updated successfully.';
            message.className = 'profile-settings-message success';
            renderProfilePage();
        } catch (error) {
            console.error('Profile update failed:', error);
            message.textContent = error.message || 'Unable to save profile changes.';
            message.className = 'profile-settings-message error';
        } finally {
            saveButton.disabled = false;
        }
    });
}

window.initProfile = window.initProfile;
window.renderProfilePage = renderProfilePage;