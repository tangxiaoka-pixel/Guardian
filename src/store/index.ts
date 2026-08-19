import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAppStore = defineStore('app', () => {
  const wsConnected = ref(false)
  return { wsConnected }
})
