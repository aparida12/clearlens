#!/bin/bash
# Production startup script for Public Health Journal
# Usage: ./start_production.sh

set -e

# Load environment variables if .env exists
if [ -f ".env" ]; then
    export $(cat .env | grep -v '#' | xargs)
fi

# Ensure virtual environment is activated
if [ ! -d ".venv" ]; then
    echo "Virtual environment not found. Creating one..."
    python3 -m venv .venv
fi

source .venv/bin/activate

# Install/update dependencies
pip install -r requirements.txt

# Initialize database
python -c "from web_app import init_web_tables; init_web_tables()"

# Run with Gunicorn
echo "Starting Public Health Journal on ${BIND:-0.0.0.0:5000}..."
gunicorn \
    --workers ${WORKERS:-4} \
    --bind ${BIND:-0.0.0.0:5000} \
    --timeout ${TIMEOUT:-30} \
    --access-logfile - \
    --error-logfile - \
    wsgi:app
