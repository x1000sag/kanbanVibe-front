import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@fontsource/newsreader/500.css'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import './style.css'
import App from './App.vue'

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
