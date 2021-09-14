const mapDinamoResponse = dinamoItem => {
  const mappedItem = {};

  for (const property in dinamoItem) {
    if (dinamoItem[property]['S']) {
      mappedItem[property] = dinamoItem[property]['S'];
    } else {
      mappedItem[property] = Number(dinamoItem[property]['N']);
    }
  }
  return mappedItem;
}

module.exports = mapDinamoResponse;