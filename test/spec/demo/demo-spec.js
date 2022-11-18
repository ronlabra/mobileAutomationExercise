const { When, Then } = require("@cucumber/cucumber");

// Scenario: User checks the Auto-Complete feature
When(`User clicks "Views"`, async ()=> {
    await $("~Views").click();
});

When(`User clicks "Auto Complete"`, async ()=>{
    await driver.pause(2000);
    await $("~Auto Complete").click();
});

When(`User clicks "1. Screen Top"`, async () => {
    await driver.pause(2000);
    await $("~1. Screen Top").click();
});

When ('User clicks the Text Field typing Philippines', async()=>{
    await driver.pause(2000);
    await $("//android.widget.EditText").addValue('Philippines')
});
Then ('User should see Philippines as text displayed', async()=>{
    const textAssetion = await $("//android.widget.EditText");
    await expect(textAssetion).toHaveText("Philippines");
});