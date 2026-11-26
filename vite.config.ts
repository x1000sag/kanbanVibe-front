import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'

function dropAccountBoardFaultInProduction(): Plugin {
  return {
    name: 'drop-account-board-fault',
    apply: 'build',
    enforce: 'pre',
    transform(_code, id) {
      if (!id.includes('accountBoardFault.ts')) return null
      return {
        code: 'export function takeFault(): string | null { return null }\n',
        map: null,
      }
    },
  }
}

export default defineConfig({
  plugins: [dropAccountBoardFaultInProduction(), vue()],
})
