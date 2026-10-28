# The voice fallback test: Meta's open Omnilingual ASR (Apache 2.0) on a Modal GPU, on the same FLEURS
# clips (evals/modal_fleurs.py) the hosted model failed. Writes evals/omni-heard.json; score it with
#   python3 evals/voice-langs.py --heard evals/omni-heard.json yo_ng ha_ng ig_ng am_et sw_ke en_us
# Usage: OMNI_GPU=A10G modal run evals/modal_omni.py [--model omniASR_LLM_7B_v2]   (GPU: needs a payment method on Modal)
#        modal run evals/modal_omni.py --cpu --model omniASR_CTC_1B   (CPU only: the CTC models read a clip in one pass, fast
#        enough on CPU; the LLM 1B ran past an hour on 90 clips). One container per language, in parallel.
# ⚠️ Omnilingual's training data may include FLEURS recordings, which would flatter its scores here.
import json, os
import modal

app = modal.App('forewarn-omni')
image = (modal.Image.debian_slim(python_version='3.12').apt_install('libsndfile1', 'ffmpeg')
         .pip_install('omnilingual-asr'))
# the CPU-only run: the default torch wheels need CUDA libraries, so swap in the CPU builds of the same versions
cpu_image = image.run_commands(
    'TV=$(python -c "import importlib.metadata as m; print(m.version(\'torch\').split(\'+\')[0])") && '
    # torchaudio must be the same version as torch (2.8.0 here), not the newer one pip may have pulled
    'pip install --force-reinstall --no-deps --index-url https://download.pytorch.org/whl/cpu torch==$TV torchaudio==$TV && '
    # fairseq2's native part is built per torch variant too: its CPU build for this torch
    'FV=$(python -c "import importlib.metadata as m; print(m.version(\'fairseq2n\'))") && '
    'pip install --force-reinstall --no-deps --extra-index-url https://fair.pkg.atmeta.com/fairseq2/whl/pt$TV/cpu fairseq2n==$FV && '
    # the package pins NumPy 1.26; the newest pyarrow needs NumPy 2
    'pip install "pyarrow<17"')
HERE = os.path.dirname(os.path.abspath(__file__))
# FLEURS folder -> Omnilingual's language code
LANGS = {'en_us': 'eng_Latn', 'sw_ke': 'swh_Latn', 'yo_ng': 'yor_Latn', 'ha_ng': 'hau_Latn', 'ig_ng': 'ibo_Latn', 'am_et': 'amh_Ethi'}


# the model downloads on each run (a few GB, in Modal's data centre): Modal would not mount a cache volume here
# Modal refuses a whole app that holds a GPU function when the account has no payment method,
# so the GPU function exists only when OMNI_GPU names a GPU
GPU = os.environ.get('OMNI_GPU')
if GPU:
    @app.function(image=image, gpu=GPU, timeout=3600)
    def run(model: str, clips: dict[str, list[bytes]]):
        return work(model, clips)


@app.function(image=cpu_image, cpu=8.0, memory=32768, timeout=3600)
def run_cpu(model: str, clips: dict[str, list[bytes]]):  # one language per call
    # send the error back as text: a remote exception reaches the terminal without its message
    import traceback
    try: return work(model, clips)
    except Exception: return {'error': traceback.format_exc()[-3000:]}


def work(model: str, clips: dict[str, list[bytes]]):
    import tempfile, time
    from omnilingual_asr.models.wav2vec2_llama.lang_ids import supported_langs
    from omnilingual_asr.models.inference.pipeline import ASRInferencePipeline
    missing = [c for c in LANGS.values() if c not in supported_langs]
    t0 = time.time(); pipe = ASRInferencePipeline(model_card=model); load = time.time() - t0
    out, d = {}, tempfile.mkdtemp()
    for lang, wavs in clips.items():
        paths = []
        for i, w in enumerate(wavs):
            p = os.path.join(d, f'{lang}-{i}.wav'); open(p, 'wb').write(w); paths.append(p)
        t = time.time()
        out[lang] = {'heard': pipe.transcribe(paths, lang=[LANGS[lang]] * len(paths), batch_size=4), 'seconds': round(time.time() - t, 1)}
    return {'model': model, 'loadSeconds': round(load, 1), 'missingLangCodes': missing, 'langs': out}


@app.local_entrypoint()
def main(model: str = 'omniASR_LLM_7B_v2', langs: str = ','.join(LANGS), cpu: bool = False):
    # clips over 30 s are left out (the app takes 30 s at most, the model 40 s); their place stays None
    clips, kept = {}, {}
    for lang in langs.split(','):
        meta = json.load(open(os.path.join(HERE, 'fleurs', f'{lang}.json')))
        wavs = [open(os.path.join(HERE, 'fleurs', lang, f"{c['n']}.wav"), 'rb').read() for c in meta['clips']]
        kept[lang] = [i for i, w in enumerate(wavs) if (len(w) - 44) / 32000 <= 30]
        clips[lang] = [wavs[i] for i in kept[lang]]
    fn = run_cpu if cpu or not GPU else run
    parts = list(fn.starmap([(model, {k: v}) for k, v in clips.items()], return_exceptions=True))
    r = {'model': model, 'device': 'cpu' if cpu or not GPU else GPU, 'langs': {}, 'errors': []}
    for p in parts:
        if isinstance(p, Exception) or 'error' in p: r['errors'].append(str(p.get('error') if isinstance(p, dict) else p)[-800:]); continue
        for lang, v in p['langs'].items():
            n = len(json.load(open(os.path.join(HERE, 'fleurs', f'{lang}.json')))['clips']); full = [None] * n
            for i, h in zip(kept[lang], v['heard']): full[i] = h
            r['langs'][lang] = {**v, 'heard': full}
        r['loadSeconds'] = p['loadSeconds']; r['missingLangCodes'] = p['missingLangCodes']
    for e in r['errors']: print('ERROR', e)
    path = os.path.join(HERE, 'omni-heard.json')
    if os.path.exists(path):
        old = json.load(open(path))
        if old.get('model') == model: r['langs'] = {**old['langs'], **r['langs']}
    json.dump(r, open(path, 'w'), ensure_ascii=False, indent=1)
    print('model', r['model'], 'load', r.get('loadSeconds'), 's, missing codes', r.get('missingLangCodes'))
    for k, v in r['langs'].items(): print(k, v['seconds'], 's for', len(v['heard']), 'clips')
