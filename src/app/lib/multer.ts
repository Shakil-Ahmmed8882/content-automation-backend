import multer from "multer";

// In-memory storage so the buffer can be streamed straight to Cloudinary.
const storage = multer.memoryStorage();

// One image per post; validate type + size at the route/service layer.
const upload = multer({
	storage,
	limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
	fileFilter: (_req, file, cb) => {
		if (file.mimetype.startsWith("image/")) {
			cb(null, true);
		} else {
			cb(new Error("Only image files are allowed"));
		}
	},
});

export default upload;
