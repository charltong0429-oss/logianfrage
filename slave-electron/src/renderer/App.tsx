import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import ListPage from './pages/ListPage'
import NewInquiryPage from './pages/NewInquiryPage'
import DetailPage from './pages/DetailPage'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/list"       element={<ListPage />} />
        <Route path="/new"        element={<NewInquiryPage />} />
        <Route path="/detail/:id" element={<DetailPage />} />
        <Route path="*"           element={<Navigate to="/list" replace />} />
      </Routes>
    </HashRouter>
  )
}
