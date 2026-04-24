const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export const fetchApi = async (endpoint: string, options: RequestInit = {}) => {
    const token = localStorage.getItem('token');
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options.headers,
    };

    const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        let errorMsg = response.statusText;
        try {
            const errBody = await response.json();
            if (errBody.error) {
                if (typeof errBody.error === 'string') {
                    errorMsg = errBody.error;
                } else if (errBody.error.message) {
                    errorMsg = errBody.error.message;
                } else if (errBody.error.error && typeof errBody.error.error === 'string') {
                    errorMsg = errBody.error.error;
                } else if (errBody.error.error?.message) {
                    errorMsg = errBody.error.error.message;
                } else {
                    errorMsg = JSON.stringify(errBody.error);
                }
            }
        } catch (e) { }
        throw new Error(errorMsg);
    }

    return response.json();
};
