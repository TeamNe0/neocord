import { Link } from "react-router";

export function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="not-found">
      <h1>This page does not exist</h1>
      <p>The address may be out of date. Go to the documentation, or press Ctrl K to search it.</p>
      <p className="not-found-links">
        <Link to="/docs" className="button button-primary">
          Open the docs
        </Link>
        <Link to="/" className="button">
          Go to the home page
        </Link>
      </p>
    </main>
  );
}
