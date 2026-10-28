# The voice language test: each FLEURS clip (evals/modal_fleurs.py) goes to Meta's Muse Voice
# Transcribe exactly as the app sends it, and the words that come back are scored against what the
# speaker read. WER: the share of words wrong (substituted, missing or extra). CER: the same for letters.
# A language passes when its median WER is at most 25%. Usage: python3 evals/voice-langs.py [lang ...]
# With --heard FILE (from evals/modal_omni.py) it scores those transcripts instead of calling Meta's API.
# Reads the key from ../.env (MODEL_API_KEY, never printed). Writes evals/voice-langs.json.
import json, os, re, subprocess, sys, unicodedata, statistics
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
KEY = next(l.split('=', 1)[1].strip() for l in open(os.path.join(HERE, '..', '.env')) if l.startswith('MODEL_API_KEY='))
PASS = 0.25

def norm(s):
    s = unicodedata.normalize('NFC', s.lower())
    s = ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')  # tone marks count as the same letter
    return re.sub(r'[^\w\s]', ' ', s).split()

def dist(a, b):
    d = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        prev, d[0] = d[0], i
        for j, y in enumerate(b, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (x != y))
    return d[-1]

def transcribe(path):
    out = subprocess.run(['curl', '-s', '-m', '90', '-X', 'POST', 'https://api.meta.ai/v1/asr/transcribe', '-H', f'Authorization: Bearer {KEY}', '-H', 'Accept: application/json',
                          '-F', 'request={"model":"muse-voice-transcribe-1.0","audioEncoding":"WAV","mode":"PUSH_TO_TALK"};type=application/json', '-F', f'audio=@{path};type=audio/wav'], capture_output=True, text=True)
    try: return json.loads(out.stdout).get('transcript', '')
    except Exception: return None

args = sys.argv[1:]
given = json.load(open(args.pop(args.index('--heard') + 1))) if '--heard' in args else None
if given: args.remove('--heard')
langs = args or ['en_us', 'fr_fr', 'sw_ke', 'yo_ng', 'ha_ng', 'ig_ng', 'am_et']
MODEL = given['model'] if given else 'muse-voice-transcribe-1.0'
result = {}
for lang in langs:
    meta = json.load(open(os.path.join(HERE, 'fleurs', f'{lang}.json')))
    if given: heard = given['langs'][lang]['heard']
    else:
        with ThreadPoolExecutor(3) as ex:
            heard = list(ex.map(lambda c: transcribe(os.path.join(HERE, 'fleurs', lang, f"{c['n']}.wav")), meta['clips']))
    rows = []
    for c, h in zip(meta['clips'], heard):
        if given and h is None: continue  # a clip over 30 s, left out of the open-model run
        ref, hyp = norm(c['text']), norm(h or '')
        rows.append({'said': c['text'], 'heard': h, 'wer': round(dist(ref, hyp) / max(len(ref), 1), 3), 'cer': round(dist(list(' '.join(ref)), list(' '.join(hyp))) / max(len(' '.join(ref)), 1), 3)})
    wer = statistics.median(r['wer'] for r in rows); cer = statistics.median(r['cer'] for r in rows)
    result[lang] = {'medianWer': round(wer, 3), 'medianCer': round(cer, 3), 'pass': wer <= PASS, 'failed': sum(r['heard'] is None for r in rows), 'clips': rows}
    print(f"{lang}: median words wrong {wer:.0%}, letters wrong {cer:.0%}, {'PASS' if wer <= PASS else 'fail'}  e.g. said \"{rows[0]['said'][:60]}\" heard \"{(rows[0]['heard'] or '')[:60]}\"", flush=True)
json.dump({'pass': f'median WER at most {PASS:.0%}', 'source': 'Google FLEURS test split (CC BY 4.0)', 'model': MODEL, 'langs': result}, open(os.path.join(HERE, 'voice-langs-omni.json' if given else 'voice-langs.json'), 'w'), ensure_ascii=False, indent=1)
