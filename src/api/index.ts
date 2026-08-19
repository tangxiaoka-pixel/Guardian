import axios from 'axios'

export const apiBase = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? '/api' : '/guardian/api')

export function apiPublicUrl(path: string) {
  if (!path) return ''
  if (/^https?:\/\//.test(path)) return path
  if (path.startsWith('/api/')) return `${apiBase}${path.slice(4)}`
  if (path.startsWith('/')) return path
  return `${apiBase}/${path}`
}

// Browser <img> requests cannot attach Axios' Authorization header.  Use the
// already authenticated console token only for same-origin asset proxies;
// the API validates it before returning protected evidence images.
export function apiAssetUrl(path: string) {
  const url = apiPublicUrl(path)
  const token = localStorage.getItem('guardian_token')
  if (!token) return url
  return `${url}${url.includes('?') ? '&' : '?'}asset_token=${encodeURIComponent(token)}`
}

const api = axios.create({ baseURL: apiBase })

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('guardian_token')
  if (token) cfg.headers.Authorization = 'Bearer ' + token
  return cfg
})

export default api
