/** @type {import('tailwindcss').Config} */
export default  {
  // 关键点：content 必须包含你的 Vue 文件路径
  content: [
  "./index.html",
  "./src/**/*.{vue,js,ts,jsx,tsx}", // 扫描子目录
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}