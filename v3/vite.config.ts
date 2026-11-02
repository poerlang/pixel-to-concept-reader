import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

/** pack-html.ts 会设置这个变量：单文件版不压缩，避开 Windows 上 esbuild 的临时文件清理问题 */
const standalone = process.env.PACK_STANDALONE === '1'

export default defineConfig(({ command }) => ({
  // 打包成 file:// 可打开的单文件时用相对路径；开发服务器仍用根路径
  base: command === 'build' ? './' : '/',
  plugins: [vue(), viteSingleFile({ removeViteModuleLoader: true })],
  server: {
    host: '127.0.0.1',
    port: 5174,
    // 编辑器/工具的原子写会留下临时目录，别让 watcher 去 watch 它（Windows 上会 EBUSY 崩掉）
    watch: { ignored: [/\.tmpdir[\\/]/, /[\\/]dist[\\/]/] },
  },
  build: {
    target: standalone ? 'esnext' : 'es2022',
    ...(standalone ? { minify: false as const } : {}),
    // JS/CSS 先由 singlefile 内联，图片等小资源也尽量内联
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
  },
}))
