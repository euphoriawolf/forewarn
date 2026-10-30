// The language of an answer, guessed from its words, for read aloud and the voice note.
export const guessLang = (t: string) => {
  const w = t.toLowerCase().match(/[a-zàâçéèêëîïôûùü]+/g) ?? [], n = (list: string[]) => w.filter((x) => list.includes(x)).length;
  const sw = n(['na', 'ya', 'wa', 'kwa', 'mvua', 'mafuriko', 'siku', 'leo', 'kesho', 'hapa', 'ni', 'za', 'katika']);
  const fr = n(['le', 'la', 'les', 'des', 'pluie', 'inondation', 'jours', 'aujourd', 'est', 'une', 'pour', 'dans']);
  const yo = (t.match(/[ẹọṣẸỌṢ]/g) ?? []).length + n(['ni', 'ti', 'àwọn', 'òjò', 'ìkún', 'omi', 'ọjọ́', 'kò', 'yìí']);
  const ha = (t.match(/[ɗƙɓƊƘƁ]/g) ?? []).length + n(['da', 'ruwa', 'ambaliyar', 'yau', 'gobe', 'ba', 'za', 'cikin', 'kuma', 'wannan']);
  const best = Math.max(sw, fr, yo, ha);
  return best <= 3 ? 'en' : best === yo ? 'yo' : best === ha ? 'ha' : best === sw ? 'sw' : 'fr';
};
