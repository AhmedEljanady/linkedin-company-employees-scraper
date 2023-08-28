const puppeteer = require("puppeteer");
const { Cluster } = require("puppeteer-cluster");
const fs = require("fs").promises;

const companyURL = "https://www.linkedin.com/company/entronix/";
// const companyURL = "https://www.linkedin.com/company/13224787/";
// const companyURL = "https://www.linkedin.com/company/pentavalue/people/";
// const companyURL = "https://www.linkedin.com/company/cellnexuk/";
// const companyURL = "https://www.linkedin.com/company/telenor-infra/people/";

let originalLang;
let urls = [];
let unAvailable = [];
let profiles = [];

//to block code execution for...
async function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

//check the original language and set it to EN
async function changeLangEn(page) {
  try {
    await page.goto("https://www.linkedin.com/mypreferences/d/language/", {
      timeout: 0,
    });
    await page.waitForNetworkIdle();

    // await page.waitForSelector("form");
    originalLang = await page.$eval(
      "#select-language .select-language__language-select",
      (select) => select.value
    );
    console.log(originalLang);

    if (originalLang === "en_US") {
      return;
    }
    // Change the language to English
    await page.select(".select-language__language-select", "en_US");
    await sleep(500);
  } catch (err) {
    console.log(`changeLangEn: ${err.message}`);
  }
}

//after finish the scraping return the origin language
async function changeLangOrigin(page) {
  await page.goto("https://www.linkedin.com/mypreferences/d/language/", {
    timeout: 0,
  });
  await page.waitForNetworkIdle();
  // Restore the original language value
  await page.select(".select-language__language-select", originalLang);
}

//scroll to bottom randomly
async function scrollPageToBottom(page) {
  let currentHeight = await page.evaluate(() =>
    document.documentElement.scrollTop.toFixed()
  );
  while (true) {
    await page.evaluate(() => {
      window.scrollBy(0, Math.floor(Math.random() * (2000 - 1000 + 1)) + 1000);
    });
    // await page.waitForTimeout(1500);
    await sleep(Math.floor(Math.random() * (4000 - 2000 + 1)) + 2000);
    const newHeight = await page.evaluate(() =>
      document.documentElement.scrollTop.toFixed()
    );
    if (newHeight === currentHeight) {
      await sleep(2000);
      if (newHeight === currentHeight) break;
    }
    currentHeight = newHeight;
  }
}

//during scrolling click show more btn
async function infiniteScrolling(page) {
  console.log(`scrolling...`);
  let i = 0;
  while (true) {
    const showMoreBtn = await page.$(
      ".scaffold-finite-scroll > div:nth-child(2) > div > button"
    );
    await scrollPageToBottom(page);
    console.log(++i);

    if (showMoreBtn) {
      try {
        await sleep(2000);
        await showMoreBtn.click({ delay: 100 });
        // showMoreBtn.click();
        await page.waitForNetworkIdle();
      } catch (err) {
        console.log(`error: ${err.message}`);
      }
    } else {
      console.log(0);
      break;
    }
  }
  console.log(`finish scrolling`);
}

//open the profiles in concurrency
async function runClusters(cookies) {
  const cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_PAGE,
    maxConcurrency: 1,
    // monitor: true,
    puppeteerOptions: {
      // headless: "new",
      headless: false,
      defaultViewport: false,
      userDataDir: "./tmp",
      timeout: 0,
      args: ["--disable-web-security"],
    },
  });

  cluster.on("taskerror", (err, data) => {
    console.log(`err ${data}: ${err.message}`);
  });

  await cluster.task(async ({ page, data: url }) => {
    // page.setDefaultNavigationTimeout(0);
    // page.setDefaultTimeout(0);
    await page.setCookie(...JSON.parse(cookies));
    const profileDetails = await scrapeProfileDetails(page, url);
    profiles.push(profileDetails);
    //TODO: edit it
    // await page.close();
    // console.log(`sleep between profiles...`);
    // await sleep(Math.floor(Math.random() * (20000 - 10000 + 1)) + 10000);
  });

  const chunkSize = 15;
  for (let i = 0; i < urls.length; i += chunkSize) {
    const chunk = urls.slice(i, i + chunkSize);
    for (const url of chunk) {
      cluster.queue(url);
    }
    await cluster.idle();
    if (i + chunkSize < urls.length) {
      console.log("sleeping for x sec...");
      await sleep(Math.floor(Math.random() * (50000 - 30000 + 1)) + 30000);
    }
  }
  await cluster.close();
}

//scrape all employees profile link
async function getPeoplesURLs(page) {
  console.log(`*****************getPeoplesURLs*******************`);

  let profImg, profTitle;
  const peoplesNode = await page.$$(
    ".scaffold-finite-scroll__content > ul > li"
  );
  const peoplesElements = Array.from(peoplesNode);

  for (let member of peoplesElements) {
    const textContent = await page.evaluate((element) => {
      return element.textContent;
    }, member);

    if (!textContent.includes("LinkedIn Member")) {
      const profileURL = await page.evaluate((member) => {
        const element = member.querySelector("a");
        return element ? element.getAttribute("href") : null;
      }, member);
      urls.push(profileURL);
    } else {
      profImg = await page.evaluate((member) => {
        const element = member.querySelector(
          "section div .artdeco-entity-lockup__image img"
        );
        return element ? element.getAttribute("src") : null;
      }, member);
      profTitle = await page.evaluate((member) => {
        const element = member.querySelector(
          ".artdeco-entity-lockup__subtitle div div"
        );
        return element ? element.textContent.trim() : null;
      }, member);
      unAvailable.push({ profImg, profTitle });
    }
  }
}

//scrape each employee profile details
async function scrapeProfileDetails(page, profileURL) {
  console.log(`*****************scrapeProfileDetails*******************`);

  try {
    await page.goto(profileURL, { timeout: 0 });
    await page.waitForNetworkIdle();
  } catch (err) {
    console.log(`cluster goto Err: ${err.message}`);
  }

  console.log(222);
  let mainSectionData,
    profileExperience,
    profileEducation,
    profileLicenses,
    profileSkills,
    profileContacts;
  try {
    mainSectionData = await scrapeMainSection(page);
    profileExperience = await scrapeExperience(page);
    profileEducation = await scrapeEducation(page);
    profileLicenses = await scrapeLicenses(page);
    profileSkills = await scrapeSkills(page);
    profileContacts = await scrapeContacts(page);
  } catch (err) {
    console.log(`cluster profiles Err: ${err.message}`);
  }
  // try {
  //   await scrollPageToBottom(page);
  // } catch (err) {
  //   console.log(`cluster scroll err: ${err.message}`);
  // }
  // await changeLangOrigin(page);
  await sleep(Math.floor(Math.random() * (3500 - 2500 + 1)) + 2500);
  return {
    ...mainSectionData,
    profileContacts,
    ...profileExperience,
    ...profileEducation,
    ...profileLicenses,
    skills: profileSkills,
  };
}

async function scrapeMainSection(page) {
  let profileImgURL,
    coverURL,
    name,
    distance,
    title,
    talksAbout,
    location,
    followers,
    connections,
    about;

  try {
    name = await page.$eval("h1", (name) => name.textContent.trim());
  } catch (err) {
    console.log(`name :${err.message}`);
  }
  console.log(name);

  try {
    profileImgURL = await page.$eval(
      "img.pv-top-card-profile-picture__image",
      (img) => img.getAttribute("src")
    );
  } catch (err) {
    console.log(`profileImgURL :${err.message}`);
  }

  try {
    coverURL = await page.$eval(".profile-background-image img", (img) =>
      img.getAttribute("src")
    );
  } catch (err) {
    console.log(`coverURL :${err.message}`);
  }

  try {
    distance = await page.$eval(".dist-value", (e) => e.textContent.trim());
  } catch (err) {
    console.log(`distance :${err.message}`);
  }

  try {
    title = await page.$eval(
      ".pv-text-details__left-panel .text-body-medium.break-words",
      (e) => e.textContent.trim()
    );
  } catch (err) {
    console.log(`title :${err.message}`);
  }

  try {
    talksAbout = await page.$eval(
      ".pv-text-details__left-panel div.text-body-small.break-words",
      (e) => e.textContent.trim()
    );
  } catch (err) {
    console.log(`talksAbout :${err.message}`);
  }

  try {
    location = await page.$eval(
      ".pv-text-details__left-panel span.text-body-small.break-words",
      (e) => e.textContent.trim()
    );
  } catch (err) {
    console.log(`location :${err.message}`);
  }

  try {
    followers = await page.$eval(
      ".pv-top-card--list > li.t-black--light > span",
      (e) => parseInt(e.textContent.replace(/,/g, "").trim())
    );
  } catch (err) {
    console.log(`followers :${err.message}`);
  }

  try {
    connections = await page.$eval(
      ".pv-top-card--list > li:not(.t-black--light) > a > span > span",
      (e) => e.textContent.trim()
    );
  } catch (err) {
    console.log(`connections :${err.message}`);
  }
  if (!connections) {
    try {
      connections = await page.$eval(
        ".pv-top-card--list > li > span > span",
        (e) => e.textContent.trim()
      );
    } catch (err) {
      console.log(`connections :${err.message}`);
    }
  }

  try {
    about = await page.$eval(
      "#about ~ div div.display-flex span.visually-hidden",
      (e) => e.textContent.replace(/\n/g, " ").trim()
    );
  } catch (err) {
    console.log(`about :${err.message}`);
  }

  return {
    name,
    profileImgURL,
    coverURL,
    distance,
    title,
    talksAbout,
    location,
    followers,
    connections,
    about,
  };
}

async function scrapeExperience(page) {
  let expTitle, expCompName, expCompLogo, expCompURL, expDuration, expLocation;
  let experience = [];
  try {
    // Get all the li elements in the Experience div
    const liElements = await page.$$("#experience ~ div > ul > li");
    const liArray = Array.from(liElements);

    // Loop through each li element and extract the title
    for (const li of liArray) {
      try {
        expTitle = await page.evaluate((li) => {
          const titleElement = li.querySelector(
            "div.display-flex.flex-row.justify-space-between > div.display-flex.flex-column.full-width > div span"
          );
          return titleElement ? titleElement.textContent.trim() : "";
        }, li);
      } catch (err) {
        `expTitle: ${err.message}`;
      }

      try {
        expCompName = await page.evaluate((li) => {
          const companyElement = li.querySelector(
            "div.display-flex.flex-row.justify-space-between > div.display-flex.flex-column.full-width > span:nth-child(2) span"
          );
          return companyElement ? companyElement.textContent.trim() : "";
        }, li);
      } catch (err) {
        `expCompName: ${err.message}`;
      }

      try {
        expCompLogo = await page.evaluate((li) => {
          const companyElement = li.querySelector(
            '[data-field="experience_company_logo"] img'
          );
          return companyElement ? companyElement.getAttribute("src") : "";
        }, li);

        if (expCompLogo) {
          expCompURL = await page.evaluate((li) => {
            const companyElement = li.querySelector(
              '[data-field="experience_company_logo"]'
            );
            return companyElement ? companyElement.getAttribute("href") : "";
          }, li);
        } else {
          expCompURL = "";
        }
      } catch (err) {
        console.log(`expCompDetails: ${err.message}`);
      }

      try {
        expDuration = await page.evaluate((li) => {
          const companyElement = li.querySelector(
            "div.display-flex.flex-row.justify-space-between > div.display-flex.flex-column.full-width > span:nth-child(3) span"
          );
          return companyElement ? companyElement.textContent.trim() : "";
        }, li);
      } catch (err) {
        `expDuration: ${err.message}`;
      }

      try {
        expLocation = await page.evaluate((li) => {
          const companyElement = li.querySelector(
            "div.display-flex.flex-row.justify-space-between > div.display-flex.flex-column.full-width > span:nth-child(4) span"
          );
          return companyElement ? companyElement.textContent.trim() : "";
        }, li);
      } catch (err) {
        `expLocation: ${err.message}`;
      }

      if (!expTitle) {
        try {
          expTitle = await page.evaluate((li) => {
            const titleElement = li.querySelector(
              "li.pvs-list__item--one-column:first-child a.optional-action-target-wrapper:not([data-field='experience_company_logo']) div span"
            );
            return titleElement ? titleElement.textContent.trim() : "";
          }, li);
        } catch (err) {
          `expTitle: ${err.message}`;
        }

        try {
          expCompName = await page.evaluate((li) => {
            const companyElement = li.querySelector(
              "div.display-flex.flex-row.justify-space-between > [data-field='experience_company_logo'] div span"
            );
            return companyElement ? companyElement.textContent.trim() : "";
          }, li);
        } catch (err) {
          `expCompName: ${err.message}`;
        }

        try {
          const finishingEle = await page.evaluate((li) => {
            const companyElement = li.querySelector(
              "li.pvs-list__item--one-column:first-child a.optional-action-target-wrapper:not([data-field='experience_company_logo']) span.t-black--light span"
            );
            return companyElement ? companyElement.textContent.trim() : "";
          }, li);
          const startEle = await page.evaluate((li) => {
            const companyElement = li.querySelector(
              "li.pvs-list__item--one-column:last-child a.optional-action-target-wrapper span.t-black--light span"
            );
            return companyElement ? companyElement.textContent.trim() : "";
          }, li);
          const durationEle = await page.evaluate((li) => {
            const companyElement = li.querySelector(
              "div.display-flex.flex-row.justify-space-between > [data-field='experience_company_logo'] span:not(.t-black--light) span"
            );
            return companyElement ? companyElement.textContent.trim() : "";
          }, li);

          const extractFinishingDate = (text) => {
            if (text.includes("Present")) {
              return "Present";
            }
            const dashIndex = text.indexOf("-");
            const dotIndex = text.indexOf("·");
            if (dashIndex !== -1 && dotIndex !== -1 && dashIndex < dotIndex) {
              const finishingDateText = text
                .substring(dashIndex + 2, dotIndex)
                .trim();
              return finishingDateText;
            }
            return null;
          };
          let starting;
          const finishing = extractFinishingDate(finishingEle);
          if (startEle.includes("-")) {
            starting = startEle.split(" - ")[0];
          } else if (startEle.includes("·")) {
            starting = startEle.split("·")[0];
          }
          console.log(`startEle: ${startEle}, starting: ${starting}`);
          const duration = durationEle.includes("·")
            ? durationEle.split("·")[1]
            : durationEle;
          expDuration = `${starting} - ${finishing} · ${duration}`;
        } catch (err) {
          `expDuration: ${err.message}`;
        }

        try {
          expLocation = await page.evaluate((li) => {
            let companyElement = li.querySelector(
              "div.display-flex.flex-row.justify-space-between > [data-field='experience_company_logo'] span.t-black--light span"
            );
            if (
              !companyElement ||
              expLocation.includes("19") ||
              expLocation.includes("20")
            ) {
              companyElement = li.querySelector(
                "li.pvs-list__item--one-column:first-child a.optional-action-target-wrapper:not([data-field='experience_company_logo']) span:last-child span"
              );
              if (companyElement.textContent.includes("-")) companyElement = "";
            }
            if (
              !companyElement ||
              expLocation.includes("19") ||
              expLocation.includes("20")
            ) {
              companyElement = li.querySelector(
                "li.pvs-list__item--one-column:last-child a.optional-action-target-wrapper:not([data-field='experience_company_logo']) span:last-child span"
              );
            }
            return companyElement ? companyElement.textContent.trim() : "";
          }, li);
          //to solve entering date into location field
          if (expLocation.includes("19") || expLocation.includes("20")) {
            expLocation = "";
          }
        } catch (err) {
          `expLocation: ${err.message}`;
        }
      }
      experience.push({
        expTitle,
        expCompName,
        expCompLogo,
        expCompURL,
        expDuration,
        expLocation,
      });
    }
  } catch (err) {
    console.log(`ExperienceDIV :${err.message}`);
  }
  return { experience };
}

async function scrapeEducation(page) {
  let eduFrom,
    eduDegree,
    eduLogo,
    eduURL,
    eduDate = "";
  let education = [];
  try {
    // Get all the li elements in the education div
    const liElements = await page.$$("#education ~ div > ul > li");
    const liArray = Array.from(liElements);

    // Loop through each li element and extract the title
    for (const li of liArray) {
      try {
        eduFrom = await page.evaluate((li) => {
          const titleElement = li.querySelector(
            "div.display-flex.flex-row.justify-space-between > a > div span"
          );
          return titleElement ? titleElement.textContent.trim() : "";
        }, li);
      } catch (err) {
        `eduTitle: ${err.message}`;
      }

      try {
        eduDegree = await page.evaluate((li) => {
          const companyElement = li.querySelector(
            "div.display-flex.flex-row.justify-space-between > a > span:not(.t-black--light) span"
          );
          return companyElement ? companyElement.textContent.trim() : "";
        }, li);
      } catch (err) {
        `eduCompName: ${err.message}`;
      }

      try {
        eduLogo = await page.evaluate((li) => {
          const companyElement = li.querySelector(
            "div > div:nth-child(1) > a img"
          );
          return companyElement ? companyElement.getAttribute("src") : "";
        }, li);
        if (eduLogo) {
          eduURL = await page.evaluate(
            (li) =>
              li
                .querySelector("div > div:nth-child(1) > a")
                .getAttribute("href"),
            li
          );
        } else {
          eduURL = "";
        }
      } catch (err) {
        console.log(`eduCompLogo: ${err.message}`);
      }

      try {
        eduDate = await page.evaluate((li) => {
          const companyElement = li.querySelector(
            "div.display-flex.flex-row.justify-space-between > a > span.t-black--light span"
          );
          return companyElement ? companyElement.textContent.trim() : "";
        }, li);
      } catch (err) {
        `eduDuration: ${err.message}`;
      }

      education.push({
        eduFrom,
        eduDegree,
        eduLogo,
        eduURL,
        eduDate,
      });
    }
  } catch (err) {
    console.log(`EducationDIV :${err.message}`);
  }
  return { education };
}

async function scrapeLicenses(page) {
  let licenseName,
    compName,
    compLogo,
    compURL,
    licenseURL,
    licenseDate,
    credentialID;
  let license = [];
  try {
    // Get all the li elements in the licenses_and_certifications div
    const liElements = await page.$$(
      "#licenses_and_certifications ~ div > ul > li"
    );
    const liArray = Array.from(liElements);

    for (const li of liArray) {
      try {
        licenseName = await page.evaluate((li) => {
          let titleElement = li.querySelector(
            "div.display-flex.flex-row.justify-space-between > a > div span"
          );
          if (!titleElement) {
            titleElement = li.querySelector(
              "div.display-flex.flex-row.justify-space-between > div > div span"
            );
          }
          return titleElement ? titleElement.textContent.trim() : "";
        }, li);
      } catch (err) {
        `licenseTitle: ${err.message}`;
      }

      try {
        compName = await page.evaluate((li) => {
          let companyElement = li.querySelector(
            "div.display-flex.flex-row.justify-space-between > a > span:not(.t-black--light) span"
          );
          if (!companyElement) {
            companyElement = li.querySelector(
              "div.display-flex.flex-row.justify-space-between > div > span:not(.t-black--light) span"
            );
          }
          return companyElement ? companyElement.textContent.trim() : "";
        }, li);
      } catch (err) {
        `licenseCompName: ${err.message}`;
      }

      try {
        compLogo = await page.evaluate((li) => {
          const companyElement = li.querySelector(
            '[data-field="entity_image_licenses_and_certifications"] img'
          );
          return companyElement ? companyElement.getAttribute("src") : "";
        }, li);

        if (compLogo) {
          compURL = await page.evaluate((li) => {
            const companyElement = li.querySelector(
              '[data-field="entity_image_licenses_and_certifications"]'
            );
            return companyElement ? companyElement.getAttribute("href") : "";
          }, li);
        } else {
          compURL = "";
        }
      } catch (err) {
        console.log(`licenseCompLogo: ${err.message}`);
      }

      try {
        licenseURL = await page.evaluate((li) => {
          const companyElement = li.querySelector(
            "div.display-flex.flex-row.justify-space-between > a"
          );
          return companyElement ? companyElement.getAttribute("href") : "";
        }, li);
      } catch (err) {
        `licenseURL: ${err.message}`;
      }

      const dateAndOrID = await page.evaluate((li) => {
        const ele = li.querySelectorAll(
          "#licenses_and_certifications ~ div > ul > li div.display-flex.flex-row.justify-space-between span.t-black--light"
        );
        return ele ? ele.length : null;
      }, li);
      if (dateAndOrID === 2) {
        try {
          licenseDate = await page.evaluate((li) => {
            let dateElement = li.querySelector(
              "div.display-flex.flex-row.justify-space-between span.t-black--light:nth-child(2) span"
            );
            return dateElement
              ? dateElement.textContent.replace(/Issued /g, "").trim()
              : "";
          }, li);
        } catch (err) {
          `licenseDate: ${err.message}`;
        }

        try {
          credentialID = await page.evaluate((li) => {
            let companyElement = li.querySelector(
              "div.display-flex.flex-row.justify-space-between span.t-black--light:nth-child(3) span"
            );
            return companyElement
              ? companyElement.textContent.replace(/Credential ID /g, "").trim()
              : "";
          }, li);
        } catch (err) {
          `licenseID: ${err.message}`;
        }
      } else if (dateAndOrID === 1) {
        try {
          const dateOrID = await page.evaluate((li) => {
            let dateElement = li.querySelector(
              "div.display-flex.flex-row.justify-space-between  span.t-black--light span"
            );
            return dateElement ? dateElement.textContent.trim() : "";
          }, li);
          if (dateOrID.includes("ID")) {
            credentialID = dateOrID.replace(/Credential ID /g, "");
            licenseDate = "";
          } else if (dateOrID.includes("Issued")) {
            licenseDate = dateOrID.replace(/Issued /g, "");
            credentialID = "";
          } else {
            console.warn("dateOrID: LOOK HERE!!");
            console.log(dateOrID);
          }
        } catch (err) {
          `licenseDate: ${err.message}`;
        }
      } else {
        console.warn("dateAndOrID: LOOK HERE!!");
      }

      license.push({
        licenseName,
        compName,
        compLogo,
        compURL,
        licenseURL,
        licenseDate,
        credentialID,
      });
    }
  } catch (err) {
    console.log(`LicenseDIV :${err.message}`);
  }
  return { license };
}

async function scrapeSkills(page) {
  let skill = "";
  let skills = [];
  try {
    // Get all the li elements in the education div
    const liElements = await page.$$("#skills ~ div > ul > li");
    const liArray = Array.from(liElements);

    // Loop through each li element and extract the title
    for (const li of liArray) {
      try {
        skill = await page.evaluate((li) => {
          const titleElement = li.querySelector(
            '[data-field="skill_card_skill_topic"] span'
          );
          return titleElement ? titleElement.textContent.trim() : "";
        }, li);
      } catch (err) {
        `skillTitle: ${err.message}`;
      }

      skills.push(skill);
    }
  } catch (err) {
    console.log(`EducationDIV :${err.message}`);
  }
  return skills;
}

async function scrapeContacts(page) {
  let linkedinProfile, website, phone, email, twitter, birthday, ims;
  let contact;
  try {
    // await page.evaluate((btn) => {
    //   const contactBtn = btn.querySelector(
    //     "#top-card-text-details-contact-info"
    //   );
    //   return contactBtn ? contactBtn.click() : console.log("NO BTN HERE");
    // }, btn);

    const contactBtn = await page.$("#top-card-text-details-contact-info");
    await contactBtn.click({ delay: 100 });
    await page.waitForNetworkIdle();

    try {
      linkedinProfile = await page.evaluate(() => {
        const anchorElement = document.querySelector(".ci-vanity-url div > a");
        return anchorElement ? anchorElement.getAttribute("href") : "";
      });
    } catch (err) {
      `Profile : ${err.message}`;
    }

    try {
      website = await page.evaluate(() => {
        const anchorElement = document.querySelector(".ci-websites li > a");
        return anchorElement ? anchorElement.getAttribute("href") : "";
      });
    } catch (err) {
      `website: ${err.message}`;
    }

    try {
      phone = await page.evaluate(() => {
        const titleElement = document.querySelector(
          ".ci-phone li > span:first-child"
        );
        return titleElement ? titleElement.textContent.trim() : "";
      });
    } catch (err) {
      `phone: ${err.message}`;
    }

    try {
      email = await page.evaluate(() => {
        const titleElement = document.querySelector(".ci-email div");
        return titleElement ? titleElement.textContent.trim() : "";
      });
    } catch (err) {
      `email: ${err.message}`;
    }

    try {
      twitter = await page.evaluate(() => {
        const titleElement = document.querySelector(".ci-twitter a");
        return titleElement ? titleElement.getAttribute("href") : "";
      });
    } catch (err) {
      `twitter: ${err.message}`;
    }

    try {
      birthday = await page.evaluate(() => {
        const titleElement = document.querySelector(".ci-birthday div");
        return titleElement ? titleElement.textContent.trim() : "";
      });
    } catch (err) {
      `birthday: ${err.message}`;
    }

    try {
      ims = await page.evaluate(() => {
        const titleElement = document.querySelector(".ci-ims li span");
        return titleElement ? titleElement.textContent.trim() : "";
      });
    } catch (err) {
      `ims: ${err.message}`;
    }
  } catch (err) {
    console.log(`contactErr: ${err.message}`);
  }
  contact = {
    linkedinProfile,
    website,
    phone,
    email,
    twitter,
    birthday,
    ims,
  };
  return contact;
}

(async () => {
  const browser = await puppeteer.launch({
    // headless: "new",
    headless: false,
    defaultViewport: { width: 1024, height: 1024 },
  });
  const page = await browser.newPage();

  const cookies = await fs.readFile("./cookies.json");
  await page.setCookie(...JSON.parse(cookies));

  // await changeLangEn(page);

  const parts = companyURL.split("/");
  const companyName = parts[4];
  const startingURL = `https://www.linkedin.com/company/${companyName}/people/`;

  await page.goto(startingURL, {
    timeout: 0,
    waitUntil: "networkidle2",
  });
  await page.waitForNetworkIdle();

  await infiniteScrolling(page);
  await getPeoplesURLs(page);

  // console.log(urls, urls.length);
  // console.log(unAvailable, unAvailable.length);
  // await browser.close();
  // await page.close();

  await runClusters(cookies);
  // console.log(profiles);

  //save scraped profiles in json file
  try {
    const jsonProfiles = JSON.stringify(profiles, null, 2); // Convert to JSON format with 2-space indentation

    fs.writeFile("profiles.json", jsonProfiles, "utf8");

    console.log("Profiles saved to profiles.json");
  } catch (err) {
    console.log(`writeFileErr: ${err.message}`);
  }

  //log the un available profiles (Linkedin member)
  if (unAvailable.length) {
    console.log(
      `there are ${unAvailable.length} profile un available: ${JSON.stringify(
        unAvailable
      )}`
    );
  }
  await browser.close();
})();
