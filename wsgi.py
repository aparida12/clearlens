"""
WSGI entry point for production deployment with Gunicorn.
Run with: gunicorn -w 4 -b 0.0.0.0:5000 wsgi:app
"""

from web_app import app, init_web_tables

if __name__ == "__main__":
    init_web_tables()
    app.run()
