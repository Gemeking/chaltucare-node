const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Ensure upload directories exist
const uploadDirs = [
    path.join(__dirname, '../../uploads'),
    path.join(__dirname, '../../uploads/chats'),
    path.join(__dirname, '../../uploads/images'),
    path.join(__dirname, '../../uploads/videos'),
    path.join(__dirname, '../../uploads/documents'),
    path.join(__dirname, '../../uploads/payments'),
    path.join(__dirname, '../../uploads/profiles')
];

uploadDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created directory: ${dir}`);
    }
});

// Configure storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        let uploadPath = path.join(__dirname, '../../uploads/chats');
        
        // Log the request URL to help debug
        console.log('Upload request URL:', req.originalUrl);
        
        // Check if it's a payment screenshot
        if (req.originalUrl && req.originalUrl.includes('/payments/upload-screenshot')) {
            uploadPath = path.join(__dirname, '../../uploads/payments');
            console.log('✅ Payment screenshot detected, saving to:', uploadPath);
        }
        // Check if it's a profile picture upload
        else if (req.originalUrl && req.originalUrl.includes('/auth/profile/picture')) {
            uploadPath = path.join(__dirname, '../../uploads/profiles');
            console.log('👤 Profile picture detected, saving to:', uploadPath);
        }
        // Check for chat file uploads
        else if (req.originalUrl && req.originalUrl.includes('/chat/upload')) {
            if (file.mimetype.startsWith('image/')) {
                uploadPath = path.join(__dirname, '../../uploads/images');
                console.log('📷 Chat image detected, saving to:', uploadPath);
            } else if (file.mimetype.startsWith('video/')) {
                uploadPath = path.join(__dirname, '../../uploads/videos');
                console.log('🎥 Chat video detected, saving to:', uploadPath);
            } else {
                uploadPath = path.join(__dirname, '../../uploads/documents');
                console.log('📄 Chat document detected, saving to:', uploadPath);
            }
        }
        // Default for any other uploads
        else if (file.mimetype.startsWith('image/')) {
            uploadPath = path.join(__dirname, '../../uploads/images');
            console.log('📷 Default image upload, saving to:', uploadPath);
        } else if (file.mimetype.startsWith('video/')) {
            uploadPath = path.join(__dirname, '../../uploads/videos');
            console.log('🎥 Default video upload, saving to:', uploadPath);
        } else {
            uploadPath = path.join(__dirname, '../../uploads/documents');
            console.log('📄 Default document upload, saving to:', uploadPath);
        }
        
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + uuidv4();
        const ext = path.extname(file.originalname);
        cb(null, uniqueSuffix + ext);
    }
});

// File filter
const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
        'video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm', 'video/avi',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`File type ${file.mimetype} is not allowed`), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    }
});

module.exports = upload;