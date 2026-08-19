<template>
  <div class="login-wrapper">
    <el-card class="login-card" shadow="always">
      <h2>守界 Guardian 管理后台</h2>
      <el-form @submit.prevent="doLogin">
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="admin" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" placeholder="admin123" />
        </el-form-item>
        <el-button type="primary" native-type="submit" :loading="loading" style="width:100%">登录</el-button>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '../api'

const router = useRouter()
const loading = ref(false)
const form = ref({ username: '', password: '' })

async function doLogin() {
  loading.value = true
  try {
    const { data } = await api.post('/auth/login', form.value)
    localStorage.setItem('guardian_token', data.access_token)
    localStorage.setItem('guardian_console_mode', 'platform')
    localStorage.removeItem('guardian_customer_id')
    localStorage.removeItem('guardian_customer_name')
    router.push('/')
  } catch {
    ElMessage.error('登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-wrapper { display:flex; justify-content:center; align-items:center; min-height:100vh; background:#f0f2f5; }
.login-card { width:380px; }
h2 { text-align:center; margin-bottom:24px; color:#303133; }
</style>
