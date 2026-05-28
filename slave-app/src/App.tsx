import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import ListPage from './pages/ListPage'
import NewInquiryPage from './pages/NewInquiryPage'
import DetailPage from './pages/DetailPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const pwd = localStorage.getItem('slaveapp_pwd')
  if (!pwd) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/list" element={<RequireAuth><ListPage /></RequireAuth>} />
        <Route path="/new" element={<RequireAuth><NewInquiryPage /></RequireAuth>} />
        <Route path="/detail/:id" element={<RequireAuth><DetailPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/list" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
