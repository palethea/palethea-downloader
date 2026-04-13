import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="page-wrapper">
        <div className="footer-inner">
          <div>
            <div className="footer-brand">Palethea</div>
            <div className="footer-copy">&copy; 2025 Palethea. All rights reserved.</div>
          </div>
          <div className="footer-links">
            <Link to="/how-it-works">Terms of Service</Link>
            <Link to="/how-it-works">Privacy Policy</Link>
            <Link to="/how-it-works">API Documentation</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
