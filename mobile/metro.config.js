// يسمح للتطبيق باستيراد محرك التنبؤ المشترك من مجلد supabase/functions/_shared
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../supabase/functions/_shared")];
module.exports = config;
