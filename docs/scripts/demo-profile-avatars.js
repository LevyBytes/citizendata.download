(() => {
  "use strict";

  // Public dossier avatars are packaged locally; this script performs no requests.
  const avatars = {
    "Montoya": {
      "imageKey": "6338cd689dd2a55b27b7cc2747c43a444c018b1dd47d29f202bc74f17723a71e",
      "normalizationVersion": 1,
      "role": "avatar",
      "url": "https://robertsspaceindustries.com/media/s40k5rnvzl32ur/heap_infobox/Forumavatar.png",
      "altText": "Montoya public dossier avatar",
      "width": 165,
      "height": 165,
      "mimeTypeHint": "image/png"
    },
    "DirectorGunner": {
      "imageKey": "e4fad698b797f97e160a248c860c6346c42a640734833a012c1c324e4dcca6c8",
      "normalizationVersion": 1,
      "role": "avatar",
      "url": "https://robertsspaceindustries.com/media/bu2zob76x7rpbr/heap_infobox/TEST_Discord_Avatar5.png",
      "altText": "DirectorGunner public dossier avatar",
      "width": 165,
      "height": 165,
      "mimeTypeHint": "image/png"
    },
    "ChromeNinja": {
      "imageKey": "c306199d65dab5d5e865d928b0d5a7743eac7afceb929cc3bbc810a76c907d21",
      "normalizationVersion": 1,
      "role": "avatar",
      "url": "https://robertsspaceindustries.com/media/0lo90t7r9hvwkr/heap_infobox/2023-10-26-09_10_09-Star-Citizen-On-X_-_IRL-Reenactment-Of-Fabric-Physics-From-Yesterdays-Demonstra.png",
      "altText": "ChromeNinja public dossier avatar",
      "width": 165,
      "height": 165,
      "mimeTypeHint": "image/png"
    },
    "O-Lefty": {
      "imageKey": "a362456dc6e3acbcebf6eca0a736aed7aa53e675e0eb48e1a82ba3944be5ae56",
      "normalizationVersion": 1,
      "role": "avatar",
      "url": "https://robertsspaceindustries.com/media/855cbb58ferrdr/heap_infobox/TESTAvatar-FFBB00.png",
      "altText": "O-Lefty public dossier avatar",
      "width": 165,
      "height": 165,
      "mimeTypeHint": "image/png"
    },
    "wmk": {
      "imageKey": "6a388f574a4b644288ff5d27ea7fee6f5c67a2914e198a70cfb0e64ae1a1614d",
      "normalizationVersion": 1,
      "role": "avatar",
      "url": "https://robertsspaceindustries.com/media/60edy2143f38br/heap_infobox/College_sq.jpg",
      "altText": "wmk public dossier avatar",
      "width": 165,
      "height": 165,
      "mimeTypeHint": "image/jpeg"
    },
    "Tincup": {
      "imageKey": "365c23649eb0cc4337f0d77b8bf0ff9584d6b4dbd0effe40be3821908b009999",
      "normalizationVersion": 1,
      "role": "avatar",
      "url": "https://robertsspaceindustries.com/media/oybwxa4qni99wr/heap_infobox/Pulsar-831502910.jpg",
      "altText": "Tincup public dossier avatar",
      "width": 165,
      "height": 165,
      "mimeTypeHint": "image/jpeg"
    },
    "Knax": {
      "imageKey": "f0117c03c0d4fb29d39db81cf08e5a451acc4740c11fde4ee2696daf741992c7",
      "normalizationVersion": 1,
      "role": "avatar",
      "url": "https://robertsspaceindustries.com/media/na7vyxog9q7wpr/heap_infobox/20160922_200557.jpg",
      "altText": "Knax public dossier avatar",
      "width": 165,
      "height": 165,
      "mimeTypeHint": "image/jpeg"
    },
    "mromutt": {
      "imageKey": "7220ed36e16798c539213a0673df8b0ee216e67e4250c6b1d3d5505e05a9df9b",
      "normalizationVersion": 1,
      "role": "avatar",
      "url": "https://robertsspaceindustries.com/media/cbvph8i9o4flnr/heap_infobox/Ducky-Suit.png",
      "altText": "mromutt public dossier avatar",
      "width": 165,
      "height": 165,
      "mimeTypeHint": "image/png"
    },
    "Citizen404": {
      "imageKey": "fcc30729986cc8c8ca81c7e6e4c738d3bf78ffde4a22eeb55bec03ea7b4d75b9",
      "normalizationVersion": 1,
      "role": "avatar",
      "url": "https://robertsspaceindustries.com/media/n0ntbnjkgja12r/heap_infobox/Citizen_Yellow.png",
      "altText": "Citizen404 public dossier avatar",
      "width": 165,
      "height": 165,
      "mimeTypeHint": "image/png"
    },
    "GOD_Shive": {
      "imageKey": "d4f9b92f6cdf1b78d0a7ef21396d2c4423d5d594e211135c93e37b7ae00b060d",
      "normalizationVersion": 1,
      "role": "avatar",
      "url": "https://robertsspaceindustries.com/media/g0q3if2dcv0bzr/heap_infobox/77bb0b868fd1a0a0a743542629180b47.png",
      "altText": "GOD_Shive public dossier avatar",
      "width": 165,
      "height": 165,
      "mimeTypeHint": "image/png"
    },
    "Xist": {
      "imageKey": "27ee3cd05681a1a6d89b137bfb0dea83669b009e4b889e04a713603cb9a65d27",
      "normalizationVersion": 1,
      "role": "avatar",
      "url": "https://robertsspaceindustries.com/media/uxh61o1ke79ggr/heap_infobox/Xist-TEST-2.png",
      "altText": "Xist public dossier avatar",
      "width": 165,
      "height": 165,
      "mimeTypeHint": "image/png"
    },
    "MunkenTEST": {
      "imageKey": "f68538bdc96081f9845ce77ec2c106091e4334f28ceffb24b0be34cf0b4048f2",
      "normalizationVersion": 1,
      "role": "avatar",
      "url": "https://robertsspaceindustries.com/media/iuxl8jsz1t05lr/heap_infobox/Donatello-Imgur.jpg",
      "altText": "MunkenTEST public dossier avatar",
      "width": 165,
      "height": 165,
      "mimeTypeHint": "image/jpeg"
    },
    "Krystal": {
      "imageKey": "d3f1cf1e05a341cccd67d727d708fe388e70c321419ab460ac017fcfcf70756a",
      "normalizationVersion": 1,
      "role": "avatar",
      "url": "https://robertsspaceindustries.com/media/hwh8ez24f4f8hr/heap_infobox/Le-Chuck.png",
      "altText": "Krystal public dossier avatar",
      "width": 165,
      "height": 165,
      "mimeTypeHint": "image/png"
    },
    "Arrangingstars": {
      "imageKey": "0366fbcbb3afcf342c6ac2691aa9d0f58151339fff6605ab1bb94b330b397bee",
      "normalizationVersion": 1,
      "role": "avatar",
      "url": "https://cdn.robertsspaceindustries.com/static/images/account/avatar_default_big.jpg",
      "altText": "Arrangingstars public dossier avatar",
      "width": 200,
      "height": 200,
      "mimeTypeHint": "image/jpeg"
    },
    "SpearmintVR": {
      "imageKey": "7a1141771807abc6c874dffebb5fe965cf988c54a3b8f8c0507a89c54cc7ee10",
      "normalizationVersion": 1,
      "role": "avatar",
      "url": "https://robertsspaceindustries.com/media/ln0y130cxh1rbr/heap_infobox/SpearWeddingDress.png",
      "altText": "SpearmintVR public dossier avatar",
      "width": 165,
      "height": 165,
      "mimeTypeHint": "image/png"
    },
    "Proxus-CIG": {
      "imageKey": "17857918f365564ed7d6398ab9d550ad4fde0c3085c3a585972fbf5917d606ac",
      "normalizationVersion": 1,
      "role": "avatar",
      "url": "https://robertsspaceindustries.com/media/8o50ejv5e33kur/heap_infobox/Lime-Cat-Large-Msg-128950375289.jpg",
      "altText": "Proxus-CIG public dossier avatar",
      "width": 165,
      "height": 165,
      "mimeTypeHint": "image/jpeg"
    },
    "Morphologis": {
      "imageKey": "a7696996aa4fbd2f2357c9aebaa863350601cf98fdec94b9e263850a4d55f847",
      "normalizationVersion": 1,
      "role": "avatar",
      "url": "https://robertsspaceindustries.com/media/8mjap58k10wiur/heap_infobox/WatermarkMorphoLogo.png",
      "altText": "Morphologis public dossier avatar",
      "width": 165,
      "height": 165,
      "mimeTypeHint": "image/png"
    },
    "CZenStar": {
      "imageKey": "b71230ef25c339de7f9ec61b28e4c51a53efa47ca16f74af0274ac0169a044fe",
      "normalizationVersion": 1,
      "role": "avatar",
      "url": "https://robertsspaceindustries.com/media/pmrehjp11yl7or/heap_infobox/Goggles-Sq-Sm.jpg",
      "altText": "CZenStar public dossier avatar",
      "width": 165,
      "height": 165,
      "mimeTypeHint": "image/jpeg"
    },
    "Lady_Glume": {
      "imageKey": "ddd954d341a44577b34275daef960e802226ed180c6d8dd4c8860286727357c5",
      "normalizationVersion": 1,
      "role": "avatar",
      "url": "https://robertsspaceindustries.com/media/vek2hpgaurfqdr/heap_infobox/Asian_Icon3.png",
      "altText": "Lady_Glume public dossier avatar",
      "width": 165,
      "height": 165,
      "mimeTypeHint": "image/png"
    }
  };
  for (const avatar of Object.values(avatars)) Object.freeze(avatar);
  globalThis.CITIZENDATA_PROFILE_AVATARS = Object.freeze(avatars);
  globalThis.CITIZENDATA_PROFILE_MEDIA = Object.freeze({
    "6338cd689dd2a55b27b7cc2747c43a444c018b1dd47d29f202bc74f17723a71e": "assets/demo/avatars/montoya.png",
    "e4fad698b797f97e160a248c860c6346c42a640734833a012c1c324e4dcca6c8": "assets/demo/avatars/directorgunner.png",
    "c306199d65dab5d5e865d928b0d5a7743eac7afceb929cc3bbc810a76c907d21": "assets/demo/avatars/chromeninja.png",
    "a362456dc6e3acbcebf6eca0a736aed7aa53e675e0eb48e1a82ba3944be5ae56": "assets/demo/avatars/o-lefty.png",
    "6a388f574a4b644288ff5d27ea7fee6f5c67a2914e198a70cfb0e64ae1a1614d": "assets/demo/avatars/wmk.jpg",
    "365c23649eb0cc4337f0d77b8bf0ff9584d6b4dbd0effe40be3821908b009999": "assets/demo/avatars/tincup.jpg",
    "f0117c03c0d4fb29d39db81cf08e5a451acc4740c11fde4ee2696daf741992c7": "assets/demo/avatars/knax.jpg",
    "7220ed36e16798c539213a0673df8b0ee216e67e4250c6b1d3d5505e05a9df9b": "assets/demo/avatars/mromutt.png",
    "fcc30729986cc8c8ca81c7e6e4c738d3bf78ffde4a22eeb55bec03ea7b4d75b9": "assets/demo/avatars/citizen404.png",
    "d4f9b92f6cdf1b78d0a7ef21396d2c4423d5d594e211135c93e37b7ae00b060d": "assets/demo/avatars/god-shive.png",
    "27ee3cd05681a1a6d89b137bfb0dea83669b009e4b889e04a713603cb9a65d27": "assets/demo/avatars/xist.png",
    "f68538bdc96081f9845ce77ec2c106091e4334f28ceffb24b0be34cf0b4048f2": "assets/demo/avatars/munkentest.jpg",
    "d3f1cf1e05a341cccd67d727d708fe388e70c321419ab460ac017fcfcf70756a": "assets/demo/avatars/krystal.png",
    "0366fbcbb3afcf342c6ac2691aa9d0f58151339fff6605ab1bb94b330b397bee": "assets/demo/avatars/arrangingstars.jpg",
    "7a1141771807abc6c874dffebb5fe965cf988c54a3b8f8c0507a89c54cc7ee10": "assets/demo/avatars/spearmintvr.png",
    "17857918f365564ed7d6398ab9d550ad4fde0c3085c3a585972fbf5917d606ac": "assets/demo/avatars/proxus-cig.jpg",
    "a7696996aa4fbd2f2357c9aebaa863350601cf98fdec94b9e263850a4d55f847": "assets/demo/avatars/morphologis.png",
    "b71230ef25c339de7f9ec61b28e4c51a53efa47ca16f74af0274ac0169a044fe": "assets/demo/avatars/czenstar.jpg",
    "ddd954d341a44577b34275daef960e802226ed180c6d8dd4c8860286727357c5": "assets/demo/avatars/lady-glume.png"
  });
})();
