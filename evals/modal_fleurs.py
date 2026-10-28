# Real speech for the voice language test: 15 clips per language from Google's FLEURS (native
# speakers reading sentences, CC BY 4.0), with their transcripts. Runs on Modal, so the 280 to 790 MB
# archive of each language stays in the cloud and only the clips come back (about 3 MB a language).
# Usage: modal run evals/modal_fleurs.py   Writes evals/fleurs/<lang>/<n>.wav and evals/fleurs/<lang>.json.
# Then: python3 evals/voice-langs.py
import json, os
import modal

app = modal.App('forewarn-fleurs')
image = modal.Image.debian_slim(python_version='3.12').pip_install('requests')
LANGS = ['en_us', 'fr_fr', 'sw_ke', 'yo_ng', 'ha_ng', 'ig_ng', 'am_et']
PER = 15
HERE = os.path.dirname(os.path.abspath(__file__))


@app.function(image=image, timeout=1800, cpu=1.0, memory=1024)
def clips(lang: str):
    import csv, io, tarfile, requests
    base = f'https://huggingface.co/datasets/google/fleurs/resolve/main/data/{lang}'
    rows = list(csv.reader(io.StringIO(requests.get(f'{base}/test.tsv', timeout=60).text), delimiter='\t', quoting=csv.QUOTE_NONE))
    text = {r[1]: r[2] for r in rows if len(r) > 2}
    # one clip per sentence (each sentence is read by more than one speaker)
    seen, out = set(), []
    with requests.get(f'{base}/audio/test.tar.gz', stream=True, timeout=600) as r:
        r.raise_for_status()
        with tarfile.open(fileobj=r.raw, mode='r|gz') as tar:
            for m in tar:
                name = os.path.basename(m.name)
                if not m.isfile() or name not in text or text[name] in seen: continue
                seen.add(text[name])
                out.append({'file': name, 'text': text[name], 'wav': tar.extractfile(m).read()})
                if len(out) == PER: break
    return lang, out


@app.local_entrypoint()
def main():
    for lang, got in clips.map(LANGS):
        d = os.path.join(HERE, 'fleurs', lang); os.makedirs(d, exist_ok=True)
        meta = []
        for i, c in enumerate(got):
            open(os.path.join(d, f'{i}.wav'), 'wb').write(c['wav'])
            meta.append({'n': i, 'file': c['file'], 'text': c['text']})
        json.dump({'lang': lang, 'source': 'Google FLEURS test split (CC BY 4.0)', 'clips': meta}, open(os.path.join(HERE, 'fleurs', f'{lang}.json'), 'w'), ensure_ascii=False, indent=1)
        print(lang, len(got), 'clips')
