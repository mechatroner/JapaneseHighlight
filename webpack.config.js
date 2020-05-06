const path = require('path');
// const TerserPlugin = require('terser-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
    mode: 'development',
    context: path.resolve(__dirname, 'src'),
    entry: {
        settings: './scripts/options.js',
        background: './scripts/background.js',
        black_white: './scripts/black_white.js',
        content_script: './scripts/content_script.js',
        import: './scripts/import.js',
        options: './scripts/options.js',
        popup: './scripts/popup.js',
    },
    output: {
        filename: './scripts/[name].js',
        path: path.resolve(__dirname, 'dist-chrome'),
    },
    // devtool: 'source-map',
    // optimization: {
    //     minimize: true,
    //     minimizer: [new TerserPlugin()],
    // },
    plugins: [
        new CopyPlugin(['_locales/**/*', 'data/*', 'dict/*', 'html/*', 'images/*.png', 'styles/*', 'manifest.json']),
        new CleanWebpackPlugin()
    ]
};