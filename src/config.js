// Detect if running on mobile or PC
const getBackendUrl = () => {
    // If running on localhost, use localhost
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:5000';
    }
    
    // If running on network, use the PC's IP
    // Get the current hostname (which will be the PC's IP if accessed from mobile)
    const hostname = window.location.hostname;
    return `http://${hostname}:5000`;
};

export const BACKEND_URL = getBackendUrl();
export const SOCKET_URL = BACKEND_URL;