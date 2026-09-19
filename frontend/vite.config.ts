import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 같은 Wi-Fi의 휴대폰 등에서 접속해 테스트할 수 있도록 전체 네트워크 인터페이스에 바인딩한다.
    host: true,
  },
})
