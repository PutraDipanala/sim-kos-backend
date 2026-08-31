// backend/src/helpers/fileHelper.js

/**
 * Helper untuk format file path menjadi full URL
 * Handle berbagai format path (absolute Windows, relative, dll)
 */

const formatFileUrl = (filePath, baseUrl = 'http://localhost:5000') => {
  if (!filePath) return null;

  // Jika sudah full URL, return langsung
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath;
  }

  // Jika absolute path Windows (C:\ atau backend\uploads)
  if (filePath.includes('C:\\') || filePath.includes('backend\\uploads')) {
    const filename = filePath.split('\\').pop();
    return `${baseUrl}/uploads/${filename}`;
  }

  // Jika path pakai backslash
  if (filePath.includes('\\')) {
    const filename = filePath.split('\\').pop();
    return `${baseUrl}/uploads/${filename}`;
  }

  // Jika relative path yang benar (/uploads/xxx.jpg)
  if (filePath.startsWith('/uploads/')) {
    return `${baseUrl}${filePath}`;
  }

  // Default: assume filename saja
  return `${baseUrl}/uploads/${filePath}`;
};

/**
 * Extract filename dari path apapun
 */
const getFileName = (filePath) => {
  if (!filePath) return null;

  // Handle backslash (Windows)
  if (filePath.includes('\\')) {
    return filePath.split('\\').pop();
  }

  // Handle forward slash (Unix/URL)
  if (filePath.includes('/')) {
    return filePath.split('/').pop();
  }

  return filePath;
};

/**
 * Format array files (foto atau dokumen) dengan full URL
 */
const formatFilesArray = (files, baseUrl = 'http://localhost:5000') => {
  if (!files || !Array.isArray(files)) return [];

  return files.map(file => ({
    ...file,
    url: formatFileUrl(file.file_path, baseUrl)
  }));
};

module.exports = {
  formatFileUrl,
  getFileName,
  formatFilesArray
};