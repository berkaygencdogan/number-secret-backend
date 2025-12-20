// gameLogic.js

const checkGuess = (guess, targetNumber) => {
  let plus = 0;
  let minus = 0;
  const guessArray = guess.split("");
  const targetArray = targetNumber.split("");

  // Doğru yerde olan rakamlar için kontrol
  guessArray.forEach((digit, index) => {
    if (digit === targetArray[index]) {
      plus++;
    }
  });

  // Yanlış yerde olan rakamlar için kontrol
  guessArray.forEach((digit) => {
    if (targetArray.includes(digit)) {
      minus++;
    }
  });

  // Doğru yerdeki rakamları çıkart, çünkü bunlar hem + hem de -'da sayılmamalı
  minus -= plus;

  return { plus, minus };
};

module.exports = checkGuess;
