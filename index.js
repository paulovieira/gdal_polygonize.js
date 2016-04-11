// TODO: the format must be shapefile (because we need to edit the values with ogrinfo)
var Path = require("path");
var Crypto = require("crypto");
var Shell = require("shelljs");
var Chalk = require("chalk");
var program = require("commander");

var internals = {};

program
    .version("0.0.1")
    .option("-i, --input <raster_file>", "The source raster file from which polygons are derived")
    .option("-o --output <shape_file>", "The destination vector file to which the polygons will be written")
    .option("-c, --connectedness <value>", "Connectedness (should be either 4 or 8, default is 4)", "4")
    .option("-n, --nomask", "Do not use the default validity mask for the input band (such as nodata, or alpha masks)")
    .option("-m, --mask <filename>", "Use the first band of the specified file as a validity mask (zero is invalid, non-zero is valid)")

    .option("-b, --band <band_index>", "The band on raster_file to build the polygons from")
    .option("-f, --format <ogr_format>", "Select the output format of the file to be created. Default is GML")
    .option("-l, --layer <layer_name>", "The name of the layer created to hold the polygon features")    
    .option("-f, --fieldname <field_name>", "The name of the field to create (defaults to \"DN\")")
    .option("-r, --round <round_value>", "Round value (default is 1)", "1")
    .option("-p, --precision <precision_value>", "Number of decimal places to keep for the rounding (default is 3). This option is applied only if the round value is < 1.", "3")
    .option("-q, --quiet", "The script runs in quiet mode. The progress monitor is suppressed and routine messages are not displayed")

    

    
    // .option("-i, --input", "input raster file (or directory with raster files)" )
    // .option("-o, --output", "output directory (will be created if it doesn't exist)" )
    // .option("-r, --round <round_value> ", "round parameter (integer value, default is 3)", 3)
    // .option("-p, --precision", "precision (number of decimal places to keep)")

program.on("--help", function(){

    console.log(`
This utility creates vector polygons for all connected regions of pixels in the
raster sharing a common pixel value. Each polygon is created with an attribute
indicating the pixel value of that polygon. A raster mask may also be provided 
to determine which pixels are eligible for processing.

The utility will create the output vector datasource if it does not already exist, 
defaulting to GML format.

This utility is a wrapper around gdal_polygonize.py which is part of the gdal suite.
It adds a new options to the original utility: the "--round" argument. The original 
gdal_polygonize.py utility is based on the GDALPolygonize() function which has additional
details on the algorithm.
    `);
});

program.parse(process.argv);



// verify if the required arguments have been provided

var requiredArguments = ["input", "output"];

requiredArguments.forEach(function(argumentName){
    if(!program[argumentName]){
        //console.error(Chalk.green("\n  error: argument '%s' is required\n", argumentName);
        console.error(Chalk.red(`\n  error: argument ${ argumentName} is required\n`));
        process.exit(1);
    }
});

// verify if the input argument actually corresponds to a file

var argumentName = "input"
if(!Shell.test("-f", program[argumentName])){
    console.error(Chalk.red(`\n  error: file ${ program[argumentName] } does not exist\n`));
    process.exit(1);
}

// makesure the output argument doesn't have dots (in the name)

var argumentName = "output"
if(Path.parse(program[argumentName]).name.indexOf(".")!==-1){
    console.error(Chalk.red(`\n  error: argument ${ argumentName } can't have dots in the vector file name \n`));
    process.exit(1);
}


// verify if the connectedness argument has a valid value

var argumentName = "connectedness"
if(program[argumentName]!=="4" && program[argumentName]!=="8"){
    console.error(Chalk.red(`\n  error: argument ${ argumentName } should be either 4 or 8\n`));
    process.exit(1);
}

// verify if the round argument has a valid value

var argumentName = "round"
if(isNaN(program[argumentName]) || Number(program[argumentName])<0){
    console.error(Chalk.red(`\n  error: argument ${ argumentName } should be >= 0\n`));
    process.exit(1);
}

// verify if the precision argument has a valid value

var argumentName = "precision"
if(isNaN(program[argumentName]) || Number(program[argumentName])<1 || Number(program[argumentName])>6){
    console.error(Chalk.red(`\n  error: argument ${ argumentName } should be an integer between 1 and 6\n`));
    process.exit(1);
}

// verify if the available GDAL is version 1.10 or above

var gdalVersion = Shell.exec("gdalinfo --version", {silent: true});
if(gdalVersion.stderr){
    console.error(Chalk.red(`\n  error: ${ gdalVersion.stderr }`));
    process.exit(1);
}
gdalVersion.output = gdalVersion.output.split(" ")[1];

gdalVersion.major  = gdalVersion.output.split(".")[0];
gdalVersion.minor  = gdalVersion.output.split(".")[1];

if(Number(gdalVersion.major + "." + gdalVersion.minor) < 1.10){
    console.error(Chalk.red(`\n  error: GDAL version 1.10 or higher is required\n`));
    process.exit(1);
}

var options = program.opts();

// treat the command line arguments
options.round = Number(options.round);
options.precision = Number(options.precision);
options.connectedness = Number(options.connectedness);
options.input = Path.parse(options.input);
options.output = Path.parse(options.output);
options.layer = options.layer || options.output.name;
options.fieldname = options.fieldname || "DN";

var precisionFactor = Math.pow(10, options.precision);
var random = Crypto.createHash("md5").update(Date.now().toString()).digest("hex");

options.rasterTemp = Object.assign({}, options.input);
options.rasterTemp.name = options.input.name + "-" + random;
options.rasterTemp.base = options.input.name + "-" + random + options.input.ext;

options.fieldnameTemp = "temp_" + random.substring(0,3);

//console.log(options);



var gdal_calc_py = "";

// if round is >= 1, no need to worry about precision because the rounding will 
// always produce integers
if(options.round>=1){

    gdal_calc_py = `
gdal_calc.py --overwrite --creation-option=\"COMPRESS=LZW\" \
    -A \"${ Path.format(options.input) }\" \
    --outfile=\"${ Path.format(options.rasterTemp) }\" \
    --calc=\"1.0*${ options.round }*floor((1.0/${ options.round })*A)\"
    `;
}

// if round is 0, do not use any rounding (though values will be truncated by the gicen precision)
else if(options.round===0){
    gdal_calc_py = `
gdal_calc.py --overwrite --creation-option=\"COMPRESS=LZW\" \
    -A \"${ Path.format(options.input) }\" \
    --outfile=\"${ Path.format(options.rasterTemp) }\" \
    --calc=\"1.0*${ precisionFactor }*A\"
    `;
}

// if round is between 0 and 1, the values will be rounded and precision should be adjusted;
// this case is similar of round >= 1, but here we multiply by the precision
else{
        gdal_calc_py = `
gdal_calc.py --overwrite --creation-option=\"COMPRESS=LZW\" \
    -A \"${ Path.format(options.input) }\" \
    --outfile=\"${ Path.format(options.rasterTemp) }\" \
    --calc=\"1.0*${ options.round }*floor((1.0/${ options.round })*A)*${ precisionFactor }\"
        `;
}


var gdal_polygonize_py = "gdal_polygonize.py";
if(options.connectedness===8){
    gdal_polygonize_py += " -8";
}
if(options.nomask){
    gdal_polygonize_py += " -nomask";
}
if(options.mask){
    gdal_polygonize_py += " -mask \"" + options.mask + "\"";
}
if(options.band){
    gdal_polygonize_py += " -b " + options.band;
}
if(options.format){
    gdal_polygonize_py += " -f \"" + options.format + "\"";
}
if(options.quiet){
    gdal_polygonize_py += " -q ";
}
gdal_polygonize_py += " \"" + Path.format(options.rasterTemp) + "\"";

var outputVector = Path.join(options.output.dir, options.output.name + options.output.ext);
gdal_polygonize_py += " \"" + outputVector + "\"";
gdal_polygonize_py += " \"" + options.layer + "\"";
gdal_polygonize_py += " \"" + options.fieldnameTemp + "\"";


//console.log(gdal_polygonize_py);


console.log("==============================")
console.log(Chalk.green("[gdal_polygonize.js]") + " Creating the temporary raster with gdal_calc.py...");

gdal_calc_py = gdal_calc_py.trim();
console.log(gdal_calc_py + "\n");

var output = Shell.exec(gdal_calc_py);

if(output.stderr){
    if(output.stderr.toLowerCase().indexOf("warning")>=0){
        console.error(Chalk.yellow(`\n  warning: ${ output.stderr } \n`));
    }
    else{
        console.error(Chalk.red(`\n  error: ${ output.stderr } \n`));
        process.exit(1);
    }

}

Shell.rm("-rf", Path.join(options.output.dir, options.output.name + "*"));

console.log(Chalk.green("[gdal_polygonize.js]") + " Creating the vector with gdal_polygonize.py...");
//console.log(gdal_polygonize_py)

output = Shell.exec(gdal_polygonize_py.trim());

if(output.stderr){
    console.error(Chalk.red(`\n  error: ${ output.stderr } \n`));
    process.exit(1);    
}

Shell.rm("-rf", Path.format(options.rasterTemp));

console.log(Chalk.green("[gdal_polygonize.js]") + " Adjusting the values in the output shapefile with ogrinfo...");


var ogrinfo = "";
if(options.round>=0 && options.round<1){
    ogrinfo = `
ogrinfo ${ outputVector } -sql \"ALTER TABLE ${ options.output.name } ADD COLUMN ${ options.fieldname } float\"; \
ogrinfo ${ outputVector } -sql \"UPDATE ${ options.output.name } SET ${ options.fieldname }=${ options.fieldnameTemp }*1.0/${ precisionFactor }\" -dialect SQLite; \
ogrinfo ${ outputVector } -sql \"ALTER TABLE ${ options.output.name } DROP COLUMN ${ options.fieldnameTemp }\";
    `;
}
else{
    ogrinfo = `
ogrinfo ${ outputVector } -sql \"ALTER TABLE ${ options.output.name } ADD COLUMN ${ options.fieldname } integer\"; \
ogrinfo ${ outputVector } -sql \"UPDATE ${ options.output.name } SET ${ options.fieldname }=${ options.fieldnameTemp }\" -dialect SQLite; \
ogrinfo ${ outputVector } -sql \"ALTER TABLE ${ options.output.name } DROP COLUMN ${ options.fieldnameTemp }\";
    `;
}

ogrinfo = ogrinfo.trim();
//console.log(ogrinfo);
 output = Shell.exec(ogrinfo);

// if(output.stderr){
//     console.error(Chalk.red(`\n  error: ${ output.stderr } \n`));
//     process.exit(1);    
// }


console.log(Chalk.green("[gdal_polygonize.js]") + " All done!");
