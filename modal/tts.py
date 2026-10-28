# Read aloud in Swahili, Yoruba and Hausa: Meta's MMS text-to-speech voices (facebook/mms-tts-*,
# CC BY-NC 4.0: fine while Forewarn is free) as a small web service on Modal CPUs. The Forewarn Worker
# calls it from /api/speak with a shared token; nothing is kept. Tested in evals/modal_tts.py: 5 to 8 s
# for 13 to 21 s of speech on 4 CPUs, and Derrick approved all three voices on 28 Oct 2026.
# Deploy: modal deploy modal/tts.py   (needs the Modal secret "forewarn-tts" with TTS_TOKEN)
import modal
try: import fastapi  # in the container; the local Modal command may not have it
except ImportError: fastapi = None

app = modal.App('forewarn-tts-service')
image = (modal.Image.debian_slim(python_version='3.12')
         .pip_install('torch==2.8.0', 'transformers==4.46.3', 'scipy', 'numpy', 'fastapi[standard]', extra_index_url='https://download.pytorch.org/whl/cpu')
         # the three voices are baked into the image, so a cold start does not download them
         .run_commands('python -c "from transformers import VitsModel, AutoTokenizer; [(VitsModel.from_pretrained(f\'facebook/mms-tts-{l}\'), AutoTokenizer.from_pretrained(f\'facebook/mms-tts-{l}\')) for l in (\'swh\', \'yor\', \'hau\')]"'))
LANGS = {'sw': 'swh', 'yo': 'yor', 'ha': 'hau'}


@app.cls(image=image, cpu=4.0, memory=4096, secrets=[modal.Secret.from_name('forewarn-tts')], scaledown_window=600, timeout=120)
class Voice:
    @modal.enter()
    def load(self):
        from transformers import VitsModel, AutoTokenizer
        self.models = {k: (VitsModel.from_pretrained(f'facebook/mms-tts-{v}'), AutoTokenizer.from_pretrained(f'facebook/mms-tts-{v}')) for k, v in LANGS.items()}

    @modal.fastapi_endpoint(method='POST')
    async def speak(self, request: 'fastapi.Request'):  # noqa: F821
        import io, os, hmac, torch, scipy.io.wavfile
        from fastapi import Response
        if not hmac.compare_digest(request.headers.get('authorization', ''), f"Bearer {os.environ['TTS_TOKEN']}"):
            return Response('Not found', status_code=404)
        body = await request.json()
        lang, text = str(body.get('lang', '')), str(body.get('text', ''))[:700]
        if lang not in self.models or not text.strip():
            return Response('Send lang (sw, yo or ha) and text.', status_code=400)
        model, tok = self.models[lang]
        with torch.no_grad(): wave = model(**tok(text, return_tensors='pt')).waveform[0].numpy()
        buf = io.BytesIO(); scipy.io.wavfile.write(buf, model.config.sampling_rate, (wave * 32767).clip(-32768, 32767).astype('int16'))
        return Response(buf.getvalue(), media_type='audio/wav')
