/**
 * PBS House Loan API Client
 * Manages JWT tokens, offline cache fallback, and API calls.
 */

const API = {
  getToken() {
    return localStorage.getItem('pbs_loan_token');
  },

  setToken(token) {
    if (token) localStorage.setItem('pbs_loan_token', token);
    else localStorage.removeItem('pbs_loan_token');
  },

  getUser() {
    try {
      const u = localStorage.getItem('pbs_loan_user');
      return u ? JSON.parse(u) : null;
    } catch (e) {
      return null;
    }
  },

  setUser(user) {
    if (user) localStorage.setItem('pbs_loan_user', JSON.stringify(user));
    else localStorage.removeItem('pbs_loan_user');
  },

  async request(endpoint, options = {}) {
    const headers = options.headers || {};
    const token = this.getToken();

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const config = {
      ...options,
      headers
    };

    try {
      const response = await fetch(`/api${endpoint}`, config);

      let data;
      try {
        data = await response.json();
      } catch (e) {
        data = { success: false, message: 'সার্ভার থেকে অপ্রত্যাশিত প্রতিক্রিয়া এসেছে।' };
      }

      if (response.status === 401) {
        if (endpoint === '/auth/login') {
          throw new Error(data.message || 'ইউজারনেম বা পাসওয়ার্ড সঠিক নয়।');
        }
        this.setToken(null);
        this.setUser(null);
        window.dispatchEvent(new CustomEvent('auth-expired'));
        const error = new Error('লগইন মেয়াদ উত্তীর্ণ হয়েছে। অনুগ্রহ করে পুনরায় লগইন করুন।');
        error.data = data;
        throw error;
      }

      // If GET request was successful, cache it for offline fallback
      if (options.method === undefined || options.method === 'GET') {
        try {
          localStorage.setItem(`cache_api_${endpoint}`, JSON.stringify(data));
        } catch (e) {
          // ignore cache quota errors
        }
      }

      if (!response.ok) {
        const error = new Error(data.message || 'অনুরোধটি ব্যর্থ হয়েছে।');
        error.data = data;
        throw error;
      }

      return data;
    } catch (error) {
      // Offline fallback for GET requests
      if (options.method === undefined || options.method === 'GET') {
        const cached = localStorage.getItem(`cache_api_${endpoint}`);
        if (cached) {
          console.warn(`Serving offline cached data for /api${endpoint}`);
          const parsed = JSON.parse(cached);
          parsed._isOfflineCached = true;
          return parsed;
        }
      }
      throw error;
    }
  },

  get(endpoint, params = {}) {
    const query = new URLSearchParams(params).toString();
    const url = query ? `${endpoint}?${query}` : endpoint;
    return this.request(url, { method: 'GET' });
  },

  post(endpoint, body) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },

  postFile(endpoint, file) {
    const body = new FormData();
    body.append('file', file);
    return this.request(endpoint, { method: 'POST', body });
  },

  put(endpoint, body) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  },

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }
};
