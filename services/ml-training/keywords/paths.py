"""Where the keyword pipeline reads and writes. Override with environment variables."""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get('KWS_WORK', os.path.join(HERE, 'work'))          # clips, features, checkpoints
MODELS = os.environ.get('KWS_MODELS', os.path.join(WORK, 'models'))    # downloaded source models
APP_MODELS = os.path.abspath(os.path.join(HERE, '..', '..', '..', 'apps', 'mobile', 'assets', 'models'))
os.makedirs(WORK, exist_ok=True)
