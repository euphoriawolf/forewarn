# Read aloud in African languages: Meta's MMS text-to-speech voices (facebook/mms-tts-*, CC BY-NC 4.0,
# so for a free, non-commercial Forewarn only) on Modal CPUs. Makes one sample per language from a
# Forewarn-style answer, for a person who speaks it to judge. Igbo has no MMS voice.
# The sentences were translated by Claude, not by a speaker: the listener checks the words too.
# Usage: modal run evals/modal_tts.py   Writes evals/tts/<lang>.wav and evals/tts/samples.json.
import json, os
import modal

app = modal.App('forewarn-tts')
image = modal.Image.debian_slim(python_version='3.12').pip_install('torch==2.8.0', 'transformers==4.46.3', 'scipy', 'numpy', extra_index_url='https://download.pytorch.org/whl/cpu')
HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLES = {
    'swh': 'Mafuriko yanaweza kutokea Kibera siku ya Alhamisi. Karibu utabiri mmoja kati ya minne unaleta mvua zaidi ya milimita thelathini. Ondoa vitu vya thamani sakafuni, na hakikisha simu yako ina chaji.',
    'yor': 'Ìkún omi lè ṣẹlẹ̀ ní Ìkòyí ní Ọjọ́bọ̀. Nǹkan bí ọ̀kan nínú mẹ́rin àsọtẹ́lẹ̀ ojú ọjọ́ ló ń mú òjò tó ju ọgbọ̀n mílímítà wá. Gbé àwọn nǹkan iyebíye kúrò lórí ilẹ̀, kí o sì rí i pé fóònù rẹ ní agbára.',
    'hau': 'Ambaliyar ruwa na iya faruwa a Kano ranar Alhamis. Kusan ɗaya cikin hasashen yanayi huɗu na kawo ruwan sama fiye da milimita talatin. Ɗaga kayayyaki masu daraja daga ƙasa, kuma ka tabbatar wayarka tana da caji.',
}
ENGLISH = 'Flooding looks possible in the place on Thursday. About one in four forecasts bring more than thirty millimetres of rain. Move valuables off the floor, and keep your phone charged.'


@app.function(image=image, cpu=4.0, memory=8192, timeout=1200)
def speak(lang: str, text: str):
    import io, time, torch, scipy.io.wavfile
    from transformers import VitsModel, AutoTokenizer
    t0 = time.time()
    model, tok = VitsModel.from_pretrained(f'facebook/mms-tts-{lang}'), AutoTokenizer.from_pretrained(f'facebook/mms-tts-{lang}')
    load = time.time() - t0; t1 = time.time()
    with torch.no_grad(): wave = model(**tok(text, return_tensors='pt')).waveform[0].numpy()
    buf = io.BytesIO(); scipy.io.wavfile.write(buf, model.config.sampling_rate, (wave * 32767).clip(-32768, 32767).astype('int16'))
    return lang, buf.getvalue(), {'loadSeconds': round(load, 1), 'speakSeconds': round(time.time() - t1, 1), 'audioSeconds': round(len(wave) / model.config.sampling_rate, 1)}


@app.local_entrypoint()
def main():
    d = os.path.join(HERE, 'tts'); os.makedirs(d, exist_ok=True)
    meta = {'english': ENGLISH, 'licence': 'facebook/mms-tts-* CC BY-NC 4.0', 'samples': {}}
    for lang, wav, timing in speak.starmap(SAMPLES.items()):
        open(os.path.join(d, f'{lang}.wav'), 'wb').write(wav)
        meta['samples'][lang] = {'text': SAMPLES[lang], **timing}
        print(lang, timing)
    json.dump(meta, open(os.path.join(d, 'samples.json'), 'w'), ensure_ascii=False, indent=1)
